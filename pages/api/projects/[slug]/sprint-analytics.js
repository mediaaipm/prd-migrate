// GET /api/projects/{slug}/sprint-analytics[?sprintId=...]
//
// Read-only roll-up of a project's sprints: per-sprint summaries, a burndown for the
// focused sprint, velocity across completed sprints, per-person throughput, and the
// holidays that bend all of it.
//
// Every calculation lives in lib/sprint-metrics.js as a pure function. This file only
// gathers the inputs (tasks, sprints, holiday config) and assembles the response, which
// keeps the maths testable without a Redis instance or a session.

const { getSprints, pickFocusSprint, sortSprintsByDate } = require('../../../../lib/sprint-store')
const { listTasksByVersion } = require('../../../../lib/task-store')
const { requirePermission, requireProjectAccess } = require('../../../../lib/require-permission')
const { stripTasksMedia } = require('../../../../lib/task-media')
const { sendJsonCached } = require('../../../../lib/etag')
const { withCpuLog } = require('../../../../lib/cpu-log')
const {
  toISODate, summariseSprint, buildBurndown, buildVelocity, buildTeam, mergeTeam,
  hasExplicitPoints, completionDate, isOverdue,
} = require('../../../../lib/sprint-metrics')

// The holiday calendar is owned by another module and is entirely optional to this
// endpoint: without it the working-day maths falls back to weekends-only. Required
// defensively so a missing or broken module degrades the numbers instead of 500-ing a
// dashboard.
let holidayStore = null
try { holidayStore = require('../../../../lib/holiday-store') } catch { holidayStore = null }

const DEFAULT_CONFIG = { weekendDays: [0, 6], country: 'IN' }
const UPCOMING_DAYS = 60
const UPCOMING_LIMIT = 8

// Same shape as sprint.js's helper, deliberately duplicated rather than imported: a
// pages/api module is a route, not a library, and importing one route into another
// drags its whole handler into the bundle.
async function buildTaskMap(slug) {
  const groups = await listTasksByVersion(slug)
  const map = {}
  for (const g of groups) {
    for (const t of stripTasksMedia(g.tasks, slug, g.version)) map[t.id] = t
  }
  return map
}

// Every holiday call is individually guarded. A holiday lookup that throws must cost the
// analytics its holiday awareness, nothing more — the page still has to render.
async function loadHolidayContext(fromISO, toISO, todayISO) {
  const out = { config: { ...DEFAULT_CONFIG }, holidays: [], holidayMap: {}, upcoming: [] }
  if (!holidayStore) return out

  try {
    const cfg = await holidayStore.getHolidayConfig()
    if (cfg) {
      out.config = {
        // An empty array is a real answer — an org that works seven days a week. Only
        // a missing or malformed value falls back to Sat/Sun.
        weekendDays: Array.isArray(cfg.weekendDays) ? cfg.weekendDays : DEFAULT_CONFIG.weekendDays,
        country: cfg.country || DEFAULT_CONFIG.country,
      }
    }
  } catch { /* weekends-only */ }

  if (fromISO && toISO) {
    try {
      const list = await holidayStore.getHolidaysInRange(fromISO, toISO)
      out.holidays = Array.isArray(list) ? list : []
    } catch { out.holidays = [] }
  }

  try { out.holidayMap = holidayStore.buildHolidayMap(out.holidays) || {} } catch { out.holidayMap = {} }

  try {
    const up = await holidayStore.upcomingHolidays(todayISO, UPCOMING_DAYS, UPCOMING_LIMIT)
    out.upcoming = Array.isArray(up) ? up : []
  } catch { out.upcoming = [] }

  return out
}

function toTaskRow(task, sprintStartISO, todayISO) {
  const { date, legacy } = completionDate(task, sprintStartISO)
  const row = {
    id: task.id,
    number: task.number != null ? task.number : null,
    title: task.title || '',
    status: task.status || 'todo',
    priority: task.priority || 'medium',
    points: task.points == null ? null : Number(task.points),
    assignees: Array.isArray(task.assignees) ? task.assignees.filter(Boolean) : (task.assignee ? [task.assignee] : []),
    dueDate: task.dueDate || null,
    completedAt: task.completedAt || null,
    overdue: isOverdue(task, todayISO),
  }
  // Done before completedAt existed. The burndown dates it to the sprint start; the
  // flag lets the table say "counted from sprint start" instead of implying a date the
  // record does not have.
  if (legacy && date) row.legacyDone = true
  return row
}

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { slug, sprintId } = req.query
  if (!await requireProjectAccess(slug, req, res)) return
  if (!await requirePermission('sprint:view', slug)(req, res)) return

  try {
    const [taskMap, rawSprints] = await Promise.all([buildTaskMap(slug), getSprints(slug)])
    const sprints = (Array.isArray(rawSprints) ? rawSprints : []).filter(Boolean)

    // Passed into every pure function rather than read inside them, so a test can pin
    // the clock and get the same numbers twice.
    const today = new Date()
    const todayISO = toISODate(today)

    const ordered = sortSprintsByDate(sprints)   // newest first — the response order
    const tasksBySprint = {}
    for (const s of sprints) {
      tasksBySprint[s.id] = (s.taskIds || []).map(id => taskMap[id]).filter(Boolean)
    }

    // One holiday fetch covering every sprint window in the project, rather than one per
    // sprint. Today is included so a sprint that ended last month still yields a range
    // that contains the current working-day maths.
    const bounds = [todayISO]
    for (const s of sprints) {
      const a = toISODate(s.startDate)
      const b = toISODate(s.endDate)
      if (a) bounds.push(a)
      if (b) bounds.push(b)
    }
    const known = bounds.filter(Boolean).sort()
    const fromISO = known.length ? known[0] : null
    const toISO = known.length ? known[known.length - 1] : null

    const { config, holidays, holidayMap, upcoming } = await loadHolidayContext(fromISO, toISO, todayISO)
    const weekendDays = config.weekendDays

    const summaries = ordered.map(s => summariseSprint({
      sprint: s,
      tasks: tasksBySprint[s.id] || [],
      weekendDays,
      holidayMap,
      holidays,
      today,
    }))
    const summaryById = {}
    summaries.forEach(x => { if (x.id) summaryById[x.id] = x })

    const focusSprint = pickFocusSprint(ordered, typeof sprintId === 'string' && sprintId ? sprintId : null)
    let focus = null
    let team = []
    if (focusSprint) {
      const focusTasks = tasksBySprint[focusSprint.id] || []
      const summary = summaryById[focusSprint.id] || summariseSprint({
        sprint: focusSprint, tasks: focusTasks, weekendDays, holidayMap, holidays, today,
      })
      const startISO = toISODate(focusSprint.startDate)
      focus = {
        ...summary,
        burndown: buildBurndown({ sprint: focusSprint, tasks: focusTasks, weekendDays, holidayMap, today }),
        tasks: focusTasks.map(t => toTaskRow(t, startISO, todayISO)),
      }
      team = buildTeam({ tasks: focusTasks, workingDaysElapsed: summary.workingDaysElapsed, today })
    }

    // All-time roll-up: one team list per sprint, merged. A person's
    // sprintsParticipated is the number of those lists they appeared in.
    const teamAllTime = mergeTeam(ordered.map(s => buildTeam({
      tasks: tasksBySprint[s.id] || [],
      workingDaysElapsed: (summaryById[s.id] || {}).workingDaysElapsed || 0,
      today,
    })))

    const velocity = buildVelocity({ sprints, tasksBySprint, weekendDays, holidayMap })

    // Whether anyone in this project estimates at all. pointsOf() falls back to 1 per
    // task, so the numbers are valid either way — this only tells the UI which word to
    // put on the axis.
    const usesPoints = Object.values(taskMap).some(hasExplicitPoints)

    // `private, no-cache` — this sits behind sprint:view plus per-project access, so it
    // must never land in a shared or CDN cache. See lib/etag.js.
    return sendJsonCached(req, res, {
      slug,
      generatedAt: new Date().toISOString(),
      config,
      usesPoints,
      focusSprintId: focusSprint ? focusSprint.id : null,
      sprints: summaries,
      focus,
      velocity,
      team,
      teamAllTime,
      upcomingHolidays: upcoming,
    })
  } catch (err) {
    console.error('Sprint analytics error:', err)
    return res.status(500).json({ error: 'Failed to load sprint analytics' })
  }
}

export default withCpuLog(handler, '/api/projects/[slug]/sprint-analytics')
