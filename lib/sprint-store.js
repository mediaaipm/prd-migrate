const { Redis } = require('@upstash/redis')
const { listTasksByVersion, withTaskLock, loadTasks, saveTasks } = require('./task-store')

let _kv;
function getKv() { if (!_kv) _kv = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN, enableAutoPipelining: true }); return _kv; }

// Sprints plan STORIES (root tasks). A story's sub-tasks ride with it, so membership is
// stored as `storyIds` and expanded to every task beneath on read — a sub-task added
// mid-sprint is in the sprint without anyone re-planning. `taskIds` is kept as that
// expansion so the analytics, dashboards and sprint board keep reading what they
// always read.
//
// Lifecycle: planned → active → completed. One active sprint per project; a story is
// in at most one open (planned/active) sprint. Completing a sprint freezes its result
// (which tasks were done at close) and carries every unfinished story into the next
// sprint, creating it on the project's cadence when none is planned.
//
// Storage — one key per sprint so two edits never clobber each other, plus a project
// lock because the one-active / one-open-sprint rules span sprints:
//   sprint:{slug}:{id}        the sprint
//   sprints:{slug}            index set of ids
//   sprint-config:{slug}      cadence { lengthWeeks, startDay, endDay, autoRollover, autoStart,
//                             alwaysCreateNext, earlyComplete }
//   sprints-migrated:{slug}   set once the legacy array has been split
//   sprint:{slug}             LEGACY single array — read once by the migration, never
//                             written or deleted, so it stays as a backup

const legacyKey = slug => `sprint:${slug}`
const sprintKey = (slug, id) => `sprint:${slug}:${id}`
const indexKey = slug => `sprints:${slug}`
const configKey = slug => `sprint-config:${slug}`
const migratedKey = slug => `sprints-migrated:${slug}`

const OPEN = new Set(['planned', 'active'])
const MAX_GOAL = 500
const MAX_NOTE = 4000

class SprintError extends Error {
  constructor(message, status = 400) { super(message); this.code = 'SPRINT'; this.status = status }
}
class SprintLockError extends Error {
  constructor() { super('Another sprint change is still saving. Please retry.'); this.code = 'SPRINT_LOCK' }
}

// --- Dates ---------------------------------------------------------------------------

// Sprint days are calendar days in the team's timezone, not UTC — a sprint that ends on
// Friday must still be open on Friday evening in India.
const SPRINT_TZ = process.env.SPRINT_TZ || 'Asia/Kolkata'

function todayISO(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SPRINT_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}
function parseISO(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)) }
function fmtISO(dt) { return dt.toISOString().slice(0, 10) }
function addDays(iso, n) { const dt = parseISO(iso); dt.setUTCDate(dt.getUTCDate() + n); return fmtISO(dt) }
function weekday(iso) { return parseISO(iso).getUTCDay() }
const isISO = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

// The defaults are the team's working rhythm: two-week sprints, Monday → Friday. At the
// end of Friday the sprint closes by itself and its unfinished stories move to the next
// sprint, which is always opened (empty if nothing carried) and starts itself on
// Monday. A sprint can be completed by hand only from its last day.
const DEFAULT_CONFIG = {
  lengthWeeks: 2, startDay: 1, endDay: 5,
  autoRollover: true, autoStart: true,
  alwaysCreateNext: true, // open the next sprint at close even when nothing carries over
  earlyComplete: false,   // allow "Complete sprint" before the sprint's last day
}

function normConfig(c) {
  const src = c || {}
  const int = (v, lo, hi, d) => { const n = Number(v); return Number.isInteger(n) && n >= lo && n <= hi ? n : d }
  return {
    lengthWeeks: int(src.lengthWeeks, 1, 6, DEFAULT_CONFIG.lengthWeeks),
    startDay: int(src.startDay, 0, 6, DEFAULT_CONFIG.startDay),
    endDay: int(src.endDay, 0, 6, DEFAULT_CONFIG.endDay),
    autoRollover: src.autoRollover === undefined ? DEFAULT_CONFIG.autoRollover : !!src.autoRollover,
    autoStart: src.autoStart === undefined ? DEFAULT_CONFIG.autoStart : !!src.autoStart,
    alwaysCreateNext: src.alwaysCreateNext === undefined ? DEFAULT_CONFIG.alwaysCreateNext : !!src.alwaysCreateNext,
    earlyComplete: src.earlyComplete === undefined ? DEFAULT_CONFIG.earlyComplete : !!src.earlyComplete,
  }
}

// The first `startDay` on or after `fromISO`, and the `endDay` in the sprint's last
// week. Mon→Fri over 2 weeks: starts Mon 3rd, ends Fri 14th.
function cadenceDates(config, fromISO) {
  const cfg = normConfig(config)
  const start = addDays(fromISO, (cfg.startDay - weekday(fromISO) + 7) % 7)
  const end = addDays(start, (cfg.lengthWeeks - 1) * 7 + ((cfg.endDay - cfg.startDay + 7) % 7))
  return { startDate: start, endDate: end }
}

async function getSprintConfig(slug) {
  return normConfig(await getKv().get(configKey(slug)))
}
async function setSprintConfig(slug, config) {
  const cfg = normConfig(config)
  await getKv().set(configKey(slug), cfg)
  return cfg
}

// --- Lock ----------------------------------------------------------------------------

const LOCK_TTL_MS = 15000
const LOCK_WAIT_MS = 8000
const RELEASE_LOCK = 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end'
const sleep = ms => new Promise(r => setTimeout(r, ms))

// Same compare-and-delete lock as withTaskLock. Order is always sprint lock → task
// lock; nothing takes them the other way round, so the two cannot deadlock.
async function withSprintLock(slug, fn) {
  const kv = getKv()
  const key = `lock:sprints:${slug}`
  const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  const deadline = Date.now() + LOCK_WAIT_MS
  while ((await kv.set(key, token, { nx: true, px: LOCK_TTL_MS })) == null) {
    if (Date.now() >= deadline) throw new SprintLockError()
    await sleep(60 + Math.floor(Math.random() * 60))
  }
  try { return await fn() } finally { try { await kv.eval(RELEASE_LOCK, [key], [token]) } catch {} }
}

// --- Task index ----------------------------------------------------------------------

// One pass over every version list: id → { task, version }, children by parent, and a
// story lookup. Tasks are unique by id across versions (ids are random).
function indexTasks(groups) {
  const byId = {}
  const childrenOf = {}
  for (const g of groups) {
    for (const t of g.tasks) {
      byId[t.id] = { task: t, version: g.version }
      if (t.parentId) (childrenOf[t.parentId] = childrenOf[t.parentId] || []).push(t.id)
    }
  }
  return { byId, childrenOf }
}

function rootOf(id, idx) {
  let cur = idx.byId[id]?.task
  const seen = new Set()
  while (cur && cur.parentId && !seen.has(cur.id)) {
    seen.add(cur.id)
    const up = idx.byId[cur.parentId]?.task
    if (!up) break
    cur = up
  }
  return cur && !cur.parentId ? cur.id : null
}

// Stories plus every live (non-archived) task beneath them.
function expandStories(storyIds, idx) {
  const out = []
  const seen = new Set()
  const stack = [...(storyIds || [])].reverse()
  while (stack.length) {
    const id = stack.pop()
    if (seen.has(id)) continue
    seen.add(id)
    const entry = idx.byId[id]
    if (!entry || entry.task.archived) continue
    out.push(id)
    for (const c of (idx.childrenOf[id] || []).slice().reverse()) stack.push(c)
  }
  return out
}

// --- Read ----------------------------------------------------------------------------

function cleanSprint(s) {
  return {
    id: s.id,
    name: s.name || 'Sprint',
    goal: typeof s.goal === 'string' ? s.goal : '',
    status: ['planned', 'active', 'completed'].includes(s.status) ? s.status : 'planned',
    startDate: isISO(s.startDate) ? s.startDate : null,
    endDate: isISO(s.endDate) ? s.endDate : null,
    capacityPoints: s.capacityPoints ?? null,
    storyIds: Array.isArray(s.storyIds) ? s.storyIds : [],
    plannedStoryIds: Array.isArray(s.plannedStoryIds) ? s.plannedStoryIds : null,
    plannedTaskIds: Array.isArray(s.plannedTaskIds) ? s.plannedTaskIds : null,
    frozen: s.frozen || null,
    summary: s.summary || null,
    review: s.review || null,
    carriedInStoryIds: Array.isArray(s.carriedInStoryIds) ? s.carriedInStoryIds : [],
    startedAt: s.startedAt || null,
    completedAt: s.completedAt || null,
    completedBy: s.completedBy || null,
    autoCompleted: !!s.autoCompleted,
    createdAt: s.createdAt || new Date().toISOString(),
    updatedAt: s.updatedAt || s.createdAt || new Date().toISOString(),
  }
}

// One-time split of the legacy single-array key. Legacy membership was a mix of stories
// and sub-tasks; each id is mapped to its story so a half-picked story becomes whole.
// Runs under the sprint lock and is idempotent via the migrated flag.
async function ensureMigrated(slug) {
  if (await getKv().get(migratedKey(slug))) return
  await withSprintLock(slug, async () => {
    if (await getKv().get(migratedKey(slug))) return
    const legacy = await getKv().get(legacyKey(slug))
    const list = Array.isArray(legacy) ? legacy : (legacy && typeof legacy === 'object' ? [legacy] : [])
    if (list.length) {
      const idx = indexTasks(await listTasksByVersion(slug))
      for (const s of list) {
        if (!s || !s.id) continue
        const storyIds = [...new Set((s.taskIds || []).map(id => rootOf(id, idx)).filter(Boolean))]
        const plannedStoryIds = Array.isArray(s.plannedTaskIds)
          ? [...new Set(s.plannedTaskIds.map(id => rootOf(id, idx)).filter(Boolean))]
          : null
        const sprint = cleanSprint({ ...s, storyIds, plannedStoryIds })
        // A legacy completed sprint has no frozen result; keep its old membership so
        // its analytics read exactly what they did before.
        if (sprint.status === 'completed') sprint.frozen = { taskIds: s.taskIds || [], doneTaskIds: null }
        await getKv().set(sprintKey(slug, sprint.id), sprint)
        await getKv().sadd(indexKey(slug), sprint.id)
      }
    }
    await getKv().set(migratedKey(slug), 1)
  })
}

function sortSprints(list) {
  const key = s => String(s.startDate || s.createdAt || '')
  return list.slice().sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))
}

// Raw stored sprints, oldest first.
async function loadSprints(slug) {
  const ids = (await getKv().smembers(indexKey(slug))) || []
  if (!ids.length) return []
  const rows = await getKv().mget(...ids.map(id => sprintKey(slug, id)))
  return sortSprints(rows.filter(Boolean).map(cleanSprint))
}

// Sprints with `taskIds` resolved: the frozen membership for a closed sprint, the live
// expansion of its stories otherwise. Pass `groups` when the caller already has them.
async function getSprints(slug, groups) {
  await ensureMigrated(slug)
  const [sprints, g] = await Promise.all([loadSprints(slug), groups ? Promise.resolve(groups) : listTasksByVersion(slug)])
  return resolveSprints(sprints, g)
}

// `taskIds` for sprint records already loaded (e.g. by applyCadence).
function resolveSprints(sprints, groups) {
  const idx = indexTasks(groups)
  return sprints.map(s => withTaskIds(s, idx))
}

function withTaskIds(s, idx) {
  const taskIds = s.frozen && Array.isArray(s.frozen.taskIds) ? s.frozen.taskIds : expandStories(s.storyIds, idx)
  return { ...s, taskIds }
}

async function getSprint(slug, id) {
  const all = await getSprints(slug)
  return all.find(s => s.id === id) || null
}

// The tasks a sprint should be MEASURED on. A closed sprint reports the state it was
// closed in: a carried-over story that is finished next sprint must not turn the old
// sprint's burndown green after the fact.
function sprintTasks(sprint, taskMap) {
  const tasks = (sprint.taskIds || []).map(id => taskMap[id]).filter(Boolean)
  const done = sprint.frozen && Array.isArray(sprint.frozen.doneTaskIds) ? new Set(sprint.frozen.doneTaskIds) : null
  if (!done) return tasks
  return tasks.map(t => {
    if (done.has(t.id)) return t.status === 'done' ? t : { ...t, status: 'done', completedAt: t.completedAt || sprint.completedAt }
    return t.status === 'done' ? { ...t, status: 'in-progress', completedAt: null } : t
  })
}

// Kept for the analytics endpoint: the sprint to open on by default.
function pickFocusSprint(sprints, sprintId) {
  const list = Array.isArray(sprints) ? sprints : []
  if (!list.length) return null
  if (sprintId) return list.find(s => s.id === sprintId) || null
  return list.find(s => s.status === 'active') || sortSprintsByDate(list)[0] || null
}

// Newest first.
function sortSprintsByDate(sprints) {
  return sortSprints(Array.isArray(sprints) ? sprints : []).reverse()
}

// --- Write ---------------------------------------------------------------------------

async function put(slug, sprint) {
  const s = { ...sprint, updatedAt: new Date().toISOString() }
  delete s.taskIds
  await getKv().set(sprintKey(slug, s.id), s)
  await getKv().sadd(indexKey(slug), s.id)
  return s
}

function normGoal(v) { return typeof v === 'string' ? v.trim().slice(0, MAX_GOAL) : '' }
function normCapacity(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.min(100000, Math.round(n * 10) / 10)
}

function nextName(sprints) {
  const nums = sprints.map(s => Number((/(\d+)\s*$/.exec(s.name || '') || [])[1])).filter(Number.isFinite)
  return `Sprint ${nums.length ? Math.max(...nums) + 1 : sprints.length + 1}`
}

// The cadence slot after the last sprint on the calendar (or from today).
function nextSlot(sprints, config) {
  const lastEnd = sprints.map(s => s.endDate).filter(Boolean).sort().pop()
  const from = lastEnd && lastEnd >= todayISO() ? addDays(lastEnd, 1) : todayISO()
  return cadenceDates(config, from)
}

function newSprint(fields) {
  const now = new Date().toISOString()
  return cleanSprint({
    id: `sprint-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    status: 'planned',
    createdAt: now,
    ...fields,
  })
}

async function createSprint(slug, data) {
  await ensureMigrated(slug)
  return withSprintLock(slug, async () => {
    const [sprints, config] = await Promise.all([loadSprints(slug), getSprintConfig(slug)])
    const slot = nextSlot(sprints, config)
    const src = data || {}
    const sprint = newSprint({
      name: typeof src.name === 'string' && src.name.trim() ? src.name.trim().slice(0, 120) : nextName(sprints),
      goal: normGoal(src.goal),
      startDate: isISO(src.startDate) ? src.startDate : slot.startDate,
      endDate: isISO(src.endDate) ? src.endDate : slot.endDate,
      capacityPoints: normCapacity(src.capacityPoints),
    })
    if (sprint.endDate < sprint.startDate) throw new SprintError('The end date is before the start date.')
    return put(slug, sprint)
  })
}

async function updateSprint(slug, id, data) {
  await ensureMigrated(slug)
  return withSprintLock(slug, async () => {
    const existing = await getKv().get(sprintKey(slug, id))
    if (!existing) return null
    const s = cleanSprint(existing)
    const src = data || {}
    if ('name' in src) {
      if (typeof src.name !== 'string' || !src.name.trim()) throw new SprintError('A sprint needs a name.')
      s.name = src.name.trim().slice(0, 120)
    }
    if ('goal' in src) s.goal = normGoal(src.goal)
    if ('capacityPoints' in src) s.capacityPoints = normCapacity(src.capacityPoints)
    if ('startDate' in src && isISO(src.startDate)) s.startDate = src.startDate
    if ('endDate' in src && isISO(src.endDate)) s.endDate = src.endDate
    if (s.startDate && s.endDate && s.endDate < s.startDate) throw new SprintError('The end date is before the start date.')
    // Review notes can be written or corrected after the sprint closed.
    if ('review' in src && s.status === 'completed') s.review = normReview(src.review, s.review)
    return put(slug, s)
  })
}

function normReview(r, prev) {
  const src = r || {}
  return {
    wentWell: typeof src.wentWell === 'string' ? src.wentWell.slice(0, MAX_NOTE) : (prev?.wentWell || ''),
    toImprove: typeof src.toImprove === 'string' ? src.toImprove.slice(0, MAX_NOTE) : (prev?.toImprove || ''),
  }
}

// Leaving the backlog: a story planned into a sprint is ready to be worked, so a
// `backlog` story becomes `todo`. Other statuses are left alone.
async function promoteFromBacklog(slug, storyIds, idx) {
  const byVersion = new Map()
  for (const id of storyIds) {
    const e = idx.byId[id]
    if (!e || e.task.status !== 'backlog') continue
    const list = byVersion.get(e.version) || []
    list.push(id)
    byVersion.set(e.version, list)
  }
  for (const [version, ids] of byVersion) {
    await withTaskLock(slug, version, async () => {
      const set = new Set(ids)
      const tasks = await loadTasks(slug, version)
      let changed = false
      const next = tasks.map(t => {
        if (!set.has(t.id) || t.status !== 'backlog') return t
        changed = true
        return { ...t, status: 'todo', updatedAt: new Date().toISOString() }
      })
      if (changed) await saveTasks(slug, version, next)
    })
  }
}

// Plan stories into an open sprint. A story already in another open sprint is moved,
// never duplicated. Returns the ids that were moved out of another sprint.
async function addStories(slug, sprintId, storyIds) {
  await ensureMigrated(slug)
  return withSprintLock(slug, async () => {
    const [sprints, groups] = await Promise.all([loadSprints(slug), listTasksByVersion(slug)])
    const idx = indexTasks(groups)
    const target = sprints.find(s => s.id === sprintId)
    if (!target) throw new SprintError('Sprint not found.', 404)
    if (!OPEN.has(target.status)) throw new SprintError('Stories can only be added to a planned or active sprint.')
    const wanted = [...new Set((storyIds || []).filter(id => typeof id === 'string'))]
    for (const id of wanted) {
      const e = idx.byId[id]
      if (!e) throw new SprintError('One of those stories no longer exists.', 404)
      if (e.task.parentId) throw new SprintError('Only stories can be planned into a sprint — sub-tasks come with their story.')
    }
    const wantedSet = new Set(wanted)
    const moved = []
    for (const s of sprints) {
      if (s.id === target.id || !OPEN.has(s.status)) continue
      const keep = s.storyIds.filter(id => !wantedSet.has(id))
      if (keep.length === s.storyIds.length) continue
      moved.push(...s.storyIds.filter(id => wantedSet.has(id)).map(id => ({ storyId: id, from: s.name })))
      await put(slug, { ...s, storyIds: keep })
    }
    const merged = [...target.storyIds, ...wanted.filter(id => !target.storyIds.includes(id))]
    const saved = await put(slug, { ...target, storyIds: merged })
    await promoteFromBacklog(slug, wanted, idx)
    return { sprint: withTaskIds(saved, idx), moved }
  })
}

async function removeStories(slug, sprintId, storyIds) {
  await ensureMigrated(slug)
  return withSprintLock(slug, async () => {
    const existing = await getKv().get(sprintKey(slug, sprintId))
    if (!existing) throw new SprintError('Sprint not found.', 404)
    const s = cleanSprint(existing)
    if (!OPEN.has(s.status)) throw new SprintError('A completed sprint cannot be changed.')
    const drop = new Set(storyIds || [])
    return put(slug, { ...s, storyIds: s.storyIds.filter(id => !drop.has(id)) })
  })
}

async function startSprintLocked(slug, id, sprints, idx) {
  const s = sprints.find(x => x.id === id)
  if (!s) throw new SprintError('Sprint not found.', 404)
  if (s.status !== 'planned') throw new SprintError('Only a planned sprint can be started.')
  const active = sprints.find(x => x.status === 'active')
  if (active) throw new SprintError(`“${active.name}” is still active. Complete it first.`, 409)
  return put(slug, {
    ...s,
    status: 'active',
    startedAt: new Date().toISOString(),
    // The commitment — scope added after this is reported as scope change.
    plannedStoryIds: [...s.storyIds],
    plannedTaskIds: expandStories(s.storyIds, idx),
  })
}

async function startSprint(slug, id) {
  await ensureMigrated(slug)
  return withSprintLock(slug, async () => {
    const [sprints, groups] = await Promise.all([loadSprints(slug), listTasksByVersion(slug)])
    const idx = indexTasks(groups)
    const started = await startSprintLocked(slug, id, sprints, idx)
    return { sprint: withTaskIds(started, idx), idx }
  })
}

const pts = t => { const n = Number(t && t.points); return Number.isFinite(n) && n > 0 ? n : 1 }

// Close a sprint, freeze its result, carry unfinished stories forward.
async function completeSprintLocked(slug, id, { review, actor, auto } = {}) {
  const [sprints, groups, config] = await Promise.all([loadSprints(slug), listTasksByVersion(slug), getSprintConfig(slug)])
  const idx = indexTasks(groups)
  const s = sprints.find(x => x.id === id)
  if (!s) throw new SprintError('Sprint not found.', 404)
  if (s.status !== 'active') throw new SprintError('Only the active sprint can be completed.')
  // By hand, a sprint closes on its last day at the earliest, unless the cadence allows
  // finishing early. The automatic rollover only ever runs after the last day.
  if (!auto && !config.earlyComplete && s.endDate && todayISO() < s.endDate) {
    throw new SprintError(`${s.name || 'This sprint'} can be completed from its last day, ${s.endDate}. An admin can allow early completion in the sprint cadence settings.`)
  }

  const taskIds = expandStories(s.storyIds, idx)
  const doneTaskIds = taskIds.filter(tid => idx.byId[tid].task.status === 'done')
  const liveStories = s.storyIds.filter(sid => idx.byId[sid] && !idx.byId[sid].task.archived)
  const doneStories = liveStories.filter(sid => idx.byId[sid].task.status === 'done')
  const carried = liveStories.filter(sid => idx.byId[sid].task.status !== 'done')
  const doneSet = new Set(doneTaskIds)
  const planned = new Set(s.plannedStoryIds || s.storyIds)

  const summary = {
    committedStories: (s.plannedStoryIds || s.storyIds).length,
    addedStories: liveStories.filter(sid => !planned.has(sid)).length,
    completedStories: doneStories.length,
    carriedStories: carried.length,
    totalTasks: taskIds.length,
    completedTasks: doneTaskIds.length,
    totalPoints: taskIds.reduce((n, tid) => n + pts(idx.byId[tid].task), 0),
    completedPoints: taskIds.filter(tid => doneSet.has(tid)).reduce((n, tid) => n + pts(idx.byId[tid].task), 0),
  }

  // The next sprint: the earliest planned one, or a new one on the cadence.
  let next = sprints.filter(x => x.status === 'planned').sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)))[0] || null
  let createdNext = false
  if (!next && (carried.length || config.alwaysCreateNext)) {
    // The next free slot after every sprint on the calendar, so it never overlaps one.
    next = newSprint({ name: nextName(sprints), ...nextSlot(sprints, config) })
    createdNext = true
  }

  const completed = await put(slug, {
    ...s,
    status: 'completed',
    completedAt: new Date().toISOString(),
    completedBy: auto ? null : (actor || null),
    autoCompleted: !!auto,
    frozen: { taskIds, doneTaskIds },
    summary: { ...summary, carriedStoryIds: carried, carriedTo: carried.length && next ? next.id : null },
    review: normReview(review, null),
  })

  let nextSaved = null
  if (next) {
    if (carried.length) {
      const merged = [...next.storyIds, ...carried.filter(sid => !next.storyIds.includes(sid))]
      nextSaved = await put(slug, { ...next, storyIds: merged, carriedInStoryIds: [...new Set([...(next.carriedInStoryIds || []), ...carried])] })
    } else {
      // A sprint opened here with nothing to carry still has to be stored.
      nextSaved = createdNext ? await put(slug, next) : next
    }
  }

  // Carry-over count lives on the story itself, so the backlog, the planner and the
  // board can flag work that keeps slipping without reading sprint history.
  if (carried.length) {
    const byVersion = new Map()
    for (const sid of carried) {
      const v = idx.byId[sid].version
      byVersion.set(v, [...(byVersion.get(v) || []), sid])
    }
    for (const [version, ids] of byVersion) {
      await withTaskLock(slug, version, async () => {
        const set = new Set(ids)
        const tasks = await loadTasks(slug, version)
        await saveTasks(slug, version, tasks.map(t => (set.has(t.id) ? { ...t, carryOver: (Number(t.carryOver) || 0) + 1 } : t)))
      })
    }
  }

  return {
    completed: withTaskIds(completed, idx),
    next: nextSaved ? withTaskIds(nextSaved, idx) : null,
    createdNext,
    carried: carried.map(sid => idx.byId[sid].task),
    sprintTasks: taskIds.map(tid => idx.byId[tid].task),
    idx,
  }
}

async function completeSprint(slug, id, opts) {
  await ensureMigrated(slug)
  return withSprintLock(slug, () => completeSprintLocked(slug, id, opts))
}

// Deleting history is not allowed through here for an active sprint — complete it.
async function deleteSprint(slug, id) {
  await ensureMigrated(slug)
  return withSprintLock(slug, async () => {
    const existing = await getKv().get(sprintKey(slug, id))
    if (!existing) return null
    if (existing.status === 'active') throw new SprintError('Complete the active sprint before deleting it.')
    await getKv().del(sprintKey(slug, id))
    await getKv().srem(indexKey(slug), id)
    return cleanSprint(existing)
  })
}

async function deleteAllSprints(slug) {
  const ids = (await getKv().smembers(indexKey(slug))) || []
  await Promise.all([
    ...ids.map(id => getKv().del(sprintKey(slug, id))),
    getKv().del(indexKey(slug)),
    getKv().del(configKey(slug)),
    getKv().del(migratedKey(slug)),
    getKv().del(legacyKey(slug)),
  ])
}

// The cadence, applied. Closes an active sprint whose end date has passed (carrying
// its unfinished stories) and starts the next planned sprint once its start date
// arrives. Called by the daily cron and on every sprint read, so the board is right
// even on a day the cron did not run. Cheap when there is nothing to do: one read.
// When nothing was applied, `config` (and `sprints`, if it had to load them) are handed
// back so a reader can reuse them instead of fetching the same keys again.
async function applyCadence(slug) {
  await ensureMigrated(slug)
  const config = await getSprintConfig(slug)
  if (!config.autoRollover && !config.autoStart) return { events: [], config }
  const today = todayISO()
  const peek = await loadSprints(slug)
  const overdue = peek.find(s => s.status === 'active' && s.endDate && s.endDate < today)
  const startable = peek.some(s => s.status === 'planned' && s.startDate && s.startDate <= today)
  if (!(config.autoRollover && overdue) && !(config.autoStart && startable)) return { events: [], config, sprints: peek }

  return withSprintLock(slug, async () => {
    const events = []
    let sprints = await loadSprints(slug)
    const active = sprints.find(s => s.status === 'active' && s.endDate && s.endDate < today)
    if (config.autoRollover && active) {
      const result = await completeSprintLocked(slug, active.id, { auto: true })
      events.push({ type: 'completed', ...result })
      sprints = await loadSprints(slug)
    }
    if (config.autoStart && !sprints.some(s => s.status === 'active')) {
      const due = sprints.filter(s => s.status === 'planned' && s.startDate && s.startDate <= today)
        .sort((a, b) => a.startDate.localeCompare(b.startDate))[0]
      if (due) {
        const idx = indexTasks(await listTasksByVersion(slug))
        const started = await startSprintLocked(slug, due.id, sprints, idx)
        events.push({ type: 'started', sprint: withTaskIds(started, idx), idx })
      }
    }
    return { events }
  })
}

// Average completed points over the last three closed sprints — the capacity warning's
// yardstick. Reads the frozen summaries, so it never moves after the fact.
function velocityOf(sprints) {
  const closed = sortSprints(sprints.filter(s => s.status === 'completed' && s.summary)).slice(-3)
  if (!closed.length) return null
  return Math.round((closed.reduce((n, s) => n + (s.summary.completedPoints || 0), 0) / closed.length) * 10) / 10
}

module.exports = {
  SprintError, SprintLockError,
  todayISO, cadenceDates, getSprintConfig, setSprintConfig, DEFAULT_CONFIG,
  getSprints, resolveSprints, getSprint, sprintTasks, pickFocusSprint, sortSprintsByDate,
  createSprint, updateSprint, addStories, removeStories, startSprint, completeSprint, deleteSprint, deleteAllSprints,
  applyCadence, velocityOf, indexTasks, expandStories,
}
