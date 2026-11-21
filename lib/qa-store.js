// QA review: the stage between a dev finishing a story and the story being done.
//
//   dev moves a story to In Review (`in-review`)    → it is on the QA board
//   QA passes it                                    → Done (open sub-tasks close with it)
//   QA sends it back with a note                    → Rework (`need-rework`), placed on
//                                                     the current sprint's board
//   dev fixes it and moves it to In Review again    → back on the QA board (round 2…)
//
// Only stories go through QA — sub-tasks ride with their story. The verdict needs
// `qa:review` (QA, team lead, manager, admin by default; lib/roles.js) and is the only
// way a dev's story reaches Rework or Done: both stay on the dev status blocklist.
//
// `task.qa` is server-owned (the task PUT routes drop it from request bodies):
//   { state: 'review'|'passed'|'rework', rounds, by, at, note, submittedBy, submittedAt,
//     log: [{ verdict, by, at, note }] }   — log capped at MAX_LOG
const { listTasksByVersion, getTask, updateTask } = require('./task-store')
const { getSprints, addStories, SprintError } = require('./sprint-store')
const { getBoardColumns, setBoardColumns } = require('./prd-store')
const { unmetAcceptance, acceptanceProgress } = require('./task-acceptance')
const { addNotifications } = require('./notification-store')
const { getUserAccess, canSeeProject } = require('./user-access')
const { Redis } = require('@upstash/redis')

let _kv
function getKv() { if (!_kv) _kv = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN, enableAutoPipelining: true }); return _kv }

const QA_STATUS = 'in-review'
const REWORK_STATUS = 'need-rework'
const REWORK_COLUMN = { status: REWORK_STATUS, label: 'Rework', color: '#ea580c' }
const MAX_NOTE = 1000
const MAX_LOG = 20
const PASSED_DAYS = 14
const OPEN_SPRINT = new Set(['planned', 'active'])

class QaError extends Error {
  constructor(message, status = 400, extra = {}) { super(message); this.status = status; Object.assign(this, extra) }
}

function names(list) {
  return (Array.isArray(list) ? list : []).map(a => (typeof a === 'object' ? a?.name : a)).filter(Boolean)
}

// The sprint a story is planned in: an open one first, else the last closed one.
function sprintOf(sprints, id) {
  const holding = sprints.filter(s => (s.storyIds || []).includes(id))
  const open = holding.find(s => OPEN_SPRINT.has(s.status))
  const s = open || holding[holding.length - 1]
  return s ? { id: s.id, name: s.name, status: s.status } : null
}

// Where reworked work goes: the active sprint, else the next planned one.
function currentSprint(sprints) {
  const active = sprints.find(s => s.status === 'active')
  if (active) return active
  return sprints
    .filter(s => s.status === 'planned')
    .sort((a, b) => String(a.startDate || '9999').localeCompare(String(b.startDate || '9999')))[0] || null
}

function card(task, version, all, sprints) {
  const kids = all.filter(t => t.parentId === task.id && !t.archived)
  const ac = acceptanceProgress(task)
  return {
    id: task.id,
    version,
    number: task.number || '',
    seq: task.seq,
    title: task.title,
    description: (task.description || '').slice(0, 600),
    status: task.status,
    priority: task.priority,
    points: task.points ?? null,
    assignees: names(task.assignees),
    userStory: task.userStory || null,
    acceptance: Array.isArray(task.acceptance) ? task.acceptance : [],
    acceptanceMet: ac.met,
    acceptanceTotal: ac.total,
    subtasks: { total: kids.length, done: kids.filter(t => t.status === 'done').length },
    // For the card modal on the QA board — direct sub-tasks only.
    subtaskList: kids.map(t => ({ id: t.id, title: t.title, status: t.status, assignees: names(t.assignees) })),
    qa: task.qa || null,
    sprint: sprintOf(sprints, task.id),
    updatedAt: task.updatedAt || task.createdAt || null,
  }
}

// Everything the QA board shows, across the project's task lists (unversioned + every
// PRD version). Archived stories never appear.
async function qaQueue(slug) {
  const groups = await listTasksByVersion(slug)
  const sprints = await getSprints(slug, groups)
  const cutoff = Date.now() - PASSED_DAYS * 86400000
  const review = []; const rework = []; const passed = []
  for (const { version, tasks } of groups) {
    for (const t of tasks) {
      if (t.parentId || t.archived) continue
      if (t.status === QA_STATUS) review.push(card(t, version, tasks, sprints))
      else if (t.status === REWORK_STATUS) rework.push(card(t, version, tasks, sprints))
      else if (t.status === 'done' && t.qa?.state === 'passed' && Date.parse(t.qa.at || 0) >= cutoff) passed.push(card(t, version, tasks, sprints))
    }
  }
  // Oldest waiting first — that is the order QA should work through them.
  const since = c => Date.parse(c.qa?.submittedAt || c.updatedAt || 0) || 0
  review.sort((a, b) => since(a) - since(b))
  rework.sort((a, b) => (Date.parse(b.qa?.at || 0) || 0) - (Date.parse(a.qa?.at || 0) || 0))
  passed.sort((a, b) => (Date.parse(b.qa?.at || 0) || 0) - (Date.parse(a.qa?.at || 0) || 0))
  const columns = await getBoardColumns(slug)
  return {
    review, rework, passed,
    // A project whose stored board dropped In Review cannot feed the QA board.
    hasReviewColumn: !columns || columns.some(c => c.status === QA_STATUS),
  }
}

// A project with its own column layout gets a Rework column the first time QA sends
// something back, placed after In Progress. Projects on the defaults already have it.
async function ensureReworkColumn(slug) {
  const cols = await getBoardColumns(slug)
  if (!cols || cols.some(c => c.status === REWORK_STATUS)) return false
  const at = cols.findIndex(c => c.status === 'in-progress')
  const next = [...cols]
  next.splice(at === -1 ? next.length : at + 1, 0, REWORK_COLUMN)
  await setBoardColumns(slug, next)
  return true
}

// Puts a reworked story on the current sprint. Already there → nothing. In another
// open sprint (say the next one) → moved, since rework is current work. No open
// sprint at all → left unplanned and the caller says so.
async function placeInCurrentSprint(slug, taskId) {
  const sprints = await getSprints(slug)
  const target = currentSprint(sprints)
  if (!target) return { sprint: null, moved: false, reason: 'No active or planned sprint — the story stays unplanned.' }
  const info = { id: target.id, name: target.name, status: target.status }
  if ((target.storyIds || []).includes(taskId)) return { sprint: info, moved: false }
  try {
    await addStories(slug, target.id, [taskId])
    return { sprint: info, moved: true }
  } catch (e) {
    if (e instanceof SprintError || e?.code === 'SPRINT_LOCK') return { sprint: null, moved: false, reason: e.message }
    throw e
  }
}

// actor = { name, username, lead } — `lead` lets a lead pass a story they worked on.
async function qaVerdict(slug, { taskId, version, verdict, note, allowUnmet }, actor) {
  if (verdict !== 'pass' && verdict !== 'rework') throw new QaError('Verdict must be pass or rework.')
  const text = typeof note === 'string' ? note.trim().slice(0, MAX_NOTE) : ''
  if (verdict === 'rework' && text.length < 3) throw new QaError('Say what needs reworking (a short note is required).')

  const v = version || null
  const before = await getTask(slug, v, taskId)
  if (!before) throw new QaError('Story not found.', 404)
  if (before.parentId) throw new QaError('Only stories go through QA — sub-tasks come with their story.')
  if (before.archived) throw new QaError('This story is archived.', 409)
  if (before.status !== QA_STATUS) throw new QaError(`This story is no longer waiting for QA — it is now "${before.status}". Refresh the board.`, 409)
  if (verdict === 'pass' && !actor.lead && names(before.assignees).includes(actor.name)) {
    throw new QaError('You are assigned to this story — someone else has to pass it.', 403)
  }
  const unmet = unmetAcceptance(before)
  if (verdict === 'pass' && unmet.length && !allowUnmet) {
    throw new QaError(`${unmet.length} acceptance criteri${unmet.length === 1 ? 'on is' : 'a are'} not met.`, 409, { code: 'UNMET', unmet: unmet.map(i => i.text) })
  }

  const now = new Date().toISOString()
  const prev = before.qa || {}
  const qa = {
    ...prev,
    state: verdict === 'pass' ? 'passed' : 'rework',
    rounds: (Number(prev.rounds) || 0) + (verdict === 'rework' ? 1 : 0),
    by: actor.name,
    at: now,
    note: text || null,
    log: [...(Array.isArray(prev.log) ? prev.log : []), { verdict, by: actor.name, at: now, note: text || null }].slice(-MAX_LOG),
  }
  const patch = { status: verdict === 'pass' ? 'done' : REWORK_STATUS, qa }
  // The reason goes on the card's comment thread too, where the dev will look.
  if (verdict === 'rework') {
    patch.updates = [...(Array.isArray(before.updates) ? before.updates : []), {
      id: `upd-qa-${Date.now().toString(36)}`,
      text: `↩ Sent back from QA for rework: ${text}`,
      author: actor.name,
      mentions: [],
      createdAt: now,
    }]
  }
  if (verdict === 'rework') await ensureReworkColumn(slug)
  const cascaded = []
  // ifStatus: re-checked under the task lock — a second verdict, or a drag out of
  // review in between, gets a 409 instead of overwriting.
  const task = await updateTask(slug, v, taskId, patch, { cascade: verdict === 'pass', cascaded, ifStatus: QA_STATUS })
  const placement = verdict === 'rework' ? await placeInCurrentSprint(slug, taskId) : null
  return { task, before, cascaded, placement, note: text }
}

// Tell the people on the story what QA decided. Never throws.
async function notifyVerdict(slug, version, before, verdict, actorName, note) {
  try {
    const link = `/projects/${slug}/tasks?${version ? `version=${encodeURIComponent(version)}&` : ''}task=${encodeURIComponent(before.id)}`
    const who = new Set([...names(before.assignees), before.assignedBy].filter(Boolean))
    who.delete(actorName)
    const text = verdict === 'pass'
      ? `${actorName} passed QA on "${before.title}"`
      : `${actorName} sent "${before.title}" back for rework: ${note.length > 90 ? note.slice(0, 90) + '…' : note}`
    await Promise.all([...who].map(n => addNotifications(n, [{ type: verdict === 'pass' ? 'qa-passed' : 'qa-rework', text, link }])))
  } catch {}
}

// A story just entered review: tell the project's QA accounts. Never throws.
async function notifyQaReviewers(slug, story, actorName) {
  try {
    const kv = getKv()
    const all = (await kv.smembers('assignees')) || []
    const profiles = await Promise.all(all.map(n => kv.hgetall(`user:${n}`).catch(() => null)))
    const qa = all.filter((n, i) => profiles[i]?.role === 'qa' && n !== actorName)
    const visible = await Promise.all(qa.map(async n => canSeeProject(await getUserAccess(n), slug)))
    const text = `"${story.title}" is ready for QA review${actorName ? ` (from ${actorName})` : ''}`
    const link = `/projects/${slug}/qa`
    await Promise.all(qa.filter((_, i) => visible[i]).map(n => addNotifications(n, [{ type: 'qa-review', text, link }])))
  } catch {}
}

module.exports = {
  QA_STATUS, REWORK_STATUS, REWORK_COLUMN, QaError,
  qaQueue, qaVerdict, notifyVerdict, notifyQaReviewers, ensureReworkColumn, currentSprint,
}
