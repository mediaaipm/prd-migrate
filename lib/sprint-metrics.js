// Sprint analytics maths.
//
// Every number the /api/projects/{slug}/sprint-analytics endpoint returns is computed
// here, and NOTHING in this file touches Redis. Holidays, the weekend configuration and
// "today" are all passed in, so the whole module is a pile of pure functions that can be
// exercised from a script or a test without a database, a session or a clock.
//
// All date arithmetic runs on 'YYYY-MM-DD' strings anchored at UTC midnight. Stepping a
// UTC millisecond counter avoids the DST hole that `new Date(y, m, d + 1)` falls into
// twice a year — a sprint that silently loses or repeats a day is a burndown that never
// reconciles.

const MS_DAY = 86400000
const MAX_BURNDOWN_ROWS = 400
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function pad2(n) { return String(n).padStart(2, '0') }

// Date-only strings pass through verbatim; Date objects and ISO timestamps are read in
// the server's local calendar, which is the same calendar `today` is taken from.
function toISODate(v) {
  if (v == null || v === '') return null
  if (typeof v === 'string') {
    const s = v.trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
    const d = new Date(s)
    if (Number.isNaN(d.getTime())) return null
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
  }
  const d = v instanceof Date ? v : new Date(v)
  if (Number.isNaN(d.getTime())) return null
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function parseISO(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '')
  if (!m) return null
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(ms) ? null : ms
}

function fromMs(ms) {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

// Whole days from a to b. Negative when b is in the past.
function daysBetween(aISO, bISO) {
  const a = parseISO(aISO)
  const b = parseISO(bISO)
  if (a == null || b == null) return null
  return Math.round((b - a) / MS_DAY)
}

// Inclusive list of every calendar day in the window, hard-capped so a typo'd endDate
// (year 2999) cannot spin a request into an out-of-memory.
function eachDate(startISO, endISO, cap = MAX_BURNDOWN_ROWS) {
  const start = parseISO(startISO)
  const end = parseISO(endISO)
  if (start == null || end == null || end < start) return []
  const out = []
  for (let ms = start; ms <= end && out.length < cap; ms += MS_DAY) out.push(fromMs(ms))
  return out
}

function dayOfWeek(iso) {
  const ms = parseISO(iso)
  return ms == null ? null : new Date(ms).getUTCDay()
}

function isWeekendISO(iso, weekendDays) {
  const list = Array.isArray(weekendDays) && weekendDays.length ? weekendDays : [0, 6]
  const dow = dayOfWeek(iso)
  return dow != null && list.includes(dow)
}

// An 'optional' holiday is a day people may take off but the org does not close, so it
// still counts as a working day. Everything else (public, company) does not.
function isHolidayISO(iso, holidayMap) {
  const h = holidayMap && holidayMap[iso]
  return !!(h && h.type !== 'optional')
}

function isWorkingDay(iso, weekendDays, holidayMap) {
  return !isWeekendISO(iso, weekendDays) && !isHolidayISO(iso, holidayMap)
}

// Inclusive working-day count. Returns 0 rather than throwing on a broken window, so a
// sprint with half its dates missing still renders.
function countWorkingDays(startISO, endISO, weekendDays, holidayMap) {
  let n = 0
  for (const d of eachDate(startISO, endISO, MAX_BURNDOWN_ROWS)) {
    if (isWorkingDay(d, weekendDays, holidayMap)) n++
  }
  return n
}

// ---------------------------------------------------------------------------
// Task-level primitives
// ---------------------------------------------------------------------------

// A project that never fills in `points` must get exactly the same numbers a
// count-based board would, so an unestimated task is worth one point.
function pointsOf(task) {
  const n = Number(task && task.points)
  return Number.isFinite(n) && n > 0 ? n : 1
}

// True only when someone actually estimated this task. Drives `usesPoints`, which tells
// the UI whether to label an axis "points" or "tasks".
function hasExplicitPoints(task) {
  const n = Number(task && task.points)
  return Number.isFinite(n) && n > 0
}

function isDone(task) {
  return !!task && task.status === 'done'
}

// When a done task finished, as a calendar day.
//
// Tasks that were already done before `completedAt` existed carry no timestamp. Dating
// them "today" would draw a cliff at the right-hand edge of every burndown, so they are
// dated to the sprint start instead — pre-existing work, flagged `legacy` so the row can
// say so.
function completionDate(task, sprintStartISO) {
  if (!isDone(task)) return { date: null, legacy: false }
  const stamped = toISODate(task && task.completedAt)
  if (stamped) return { date: stamped, legacy: false }
  return { date: sprintStartISO || null, legacy: true }
}

function assigneesOf(task) {
  const raw = Array.isArray(task && task.assignees)
    ? task.assignees
    : (task && task.assignee ? [task.assignee] : [])
  return raw
    .map(a => (a && typeof a === 'object' ? a.name : a))
    .filter(a => typeof a === 'string' && a.trim())
    .map(a => a.trim())
}

function isOverdue(task, todayISO) {
  if (isDone(task)) return false
  const due = toISODate(task && task.dueDate)
  return !!(due && todayISO && due < todayISO)
}

function pct(part, whole) {
  if (!whole) return 0
  return Math.max(0, Math.min(100, Math.round((part / whole) * 100)))
}

function round1(n) {
  if (!Number.isFinite(n)) return null
  return Math.round(n * 10) / 10
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

// `started` is optional and defaults to true so the three-argument form in the spec
// keeps working; the route passes it so a sprint whose start date is still in the
// future reads 'not-started' instead of 'behind'.
function healthOf(progressPct, expectedPct, status, started = true) {
  const p = Number(progressPct) || 0
  const e = Number(expectedPct) || 0
  if (status === 'completed' || p >= 100) return 'done'
  if (!started || status === 'planned') return 'not-started'
  if (p >= e + 5) return 'ahead'
  if (p >= e - 5) return 'on-track'
  if (p >= e - 20) return 'at-risk'
  return 'behind'
}

// ---------------------------------------------------------------------------
// Sprint summary
// ---------------------------------------------------------------------------

function summariseSprint({ sprint, tasks, weekendDays, holidayMap, holidays, today }) {
  const s = sprint || {}
  const list = Array.isArray(tasks) ? tasks : []
  const todayISO = toISODate(today || new Date())
  const startISO = toISODate(s.startDate)
  const endISO = toISODate(s.endDate)

  const totalTasks = list.length
  let doneTasks = 0
  let totalPoints = 0
  let donePoints = 0
  let overdueTasks = 0
  let blockedTasks = 0
  let unassignedTasks = 0
  const byStatus = {}

  for (const t of list) {
    const p = pointsOf(t)
    totalPoints += p
    if (isDone(t)) { doneTasks++; donePoints += p }
    if (t && t.status === 'blocked') blockedTasks++
    if (isOverdue(t, todayISO)) overdueTasks++
    if (assigneesOf(t).length === 0) unassignedTasks++
    const st = (t && typeof t.status === 'string' && t.status) || 'unknown'
    byStatus[st] = (byStatus[st] || 0) + 1
  }

  const workingDays = (startISO && endISO) ? countWorkingDays(startISO, endISO, weekendDays, holidayMap) : 0

  // Elapsed stops at the sprint end, so a sprint that ran out three weeks ago does not
  // keep accruing "elapsed" days and pin every stat to 0% left.
  let workingDaysElapsed = 0
  const started = !startISO || !todayISO || todayISO >= startISO
  if (startISO && todayISO && started) {
    const upto = endISO && todayISO > endISO ? endISO : todayISO
    workingDaysElapsed = countWorkingDays(startISO, upto, weekendDays, holidayMap)
  }
  const workingDaysLeft = Math.max(0, workingDays - workingDaysElapsed)
  const calendarDaysLeft = endISO && todayISO ? daysBetween(todayISO, endISO) : null

  const windowDays = (startISO && endISO) ? eachDate(startISO, endISO) : []
  const weekendDaysInWindow = windowDays.filter(d => isWeekendISO(d, weekendDays)).length
  const inWindow = (Array.isArray(holidays) ? holidays : [])
    .filter(h => h && h.date && startISO && endISO && h.date >= startISO && h.date <= endISO)
    .map(h => ({ date: h.date, name: h.name, type: h.type || 'public' }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

  // Scope change is only knowable once the sprint went active and snapshotted its
  // taskIds. Before that there is no baseline, and {0,0} is the honest answer.
  const planned = Array.isArray(s.plannedTaskIds) ? s.plannedTaskIds : null
  const current = Array.isArray(s.taskIds) ? s.taskIds : []
  let scopeChange = { added: 0, removed: 0 }
  if (planned) {
    const plannedSet = new Set(planned)
    const currentSet = new Set(current)
    scopeChange = {
      added: current.filter(id => !plannedSet.has(id)).length,
      removed: planned.filter(id => !currentSet.has(id)).length,
    }
  }

  const taskPct = pct(doneTasks, totalTasks)
  const pointsPct = pct(donePoints, totalPoints)
  const expectedPct = workingDays > 0 ? pct(workingDaysElapsed, workingDays) : 0

  // Health tracks the points line, which is what the burndown draws. With no estimates
  // anywhere pointsOf() is 1 per task, so this collapses back to the task percentage.
  const health = healthOf(pointsPct, expectedPct, s.status, started)

  const remainingPoints = Math.max(0, totalPoints - donePoints)
  let requiredPerDay = null
  if (endISO) {
    requiredPerDay = workingDaysLeft > 0 ? round1(remainingPoints / workingDaysLeft) : round1(remainingPoints)
  }

  return {
    id: s.id || null,
    name: s.name || 'Untitled sprint',
    status: s.status || 'planned',
    goal: typeof s.goal === 'string' ? s.goal : '',
    startDate: startISO,
    endDate: endISO,
    capacityPoints: Number.isFinite(Number(s.capacityPoints)) && s.capacityPoints != null ? Number(s.capacityPoints) : null,
    totalTasks,
    doneTasks,
    openTasks: totalTasks - doneTasks,
    totalPoints: round1(totalPoints),
    donePoints: round1(donePoints),
    byStatus,
    pct: taskPct,
    pointsPct,
    workingDays,
    workingDaysElapsed,
    workingDaysLeft,
    calendarDaysLeft,
    holidays: inWindow,
    weekendDaysInWindow,
    scopeChange,
    expectedPct,
    health,
    requiredPerDay,
    overdueTasks,
    blockedTasks,
    unassignedTasks,
  }
}

// ---------------------------------------------------------------------------
// Burndown
// ---------------------------------------------------------------------------

// One row per calendar day between startDate and endDate, inclusive.
//
// The point of the whole feature is the flat segments: `idealPoints` only steps down on
// a working day, so a weekend or a public holiday shows as a horizontal run instead of
// the straight diagonal that makes every team look behind on a Monday.
//
// `remainingPoints` is total minus everything completed on or before that day. Rows after
// today carry `isFuture: true` and a null `remainingPoints`, so the UI stops the actual
// line at today rather than drawing it flat into the future.
//
// A sprint missing either date returns [] — the route still answers, the chart just
// renders its empty state.
function buildBurndown({ sprint, tasks, weekendDays, holidayMap, today }) {
  const s = sprint || {}
  const startISO = toISODate(s.startDate)
  const endISO = toISODate(s.endDate)
  if (!startISO || !endISO) return []

  const days = eachDate(startISO, endISO)
  if (!days.length) return []

  const list = Array.isArray(tasks) ? tasks : []
  const todayISO = toISODate(today || new Date())

  let totalPoints = 0
  let totalTasks = 0
  const doneOn = {}   // 'YYYY-MM-DD' -> { points, tasks } completed that day
  for (const t of list) {
    totalPoints += pointsOf(t)
    totalTasks += 1
    const { date } = completionDate(t, startISO)
    if (!date) continue
    // Work finished before the sprint opened lands on day one, so the line starts from
    // a truthful remaining figure instead of ignoring it.
    const key = date < startISO ? startISO : date
    if (!doneOn[key]) doneOn[key] = { points: 0, tasks: 0 }
    doneOn[key].points += pointsOf(t)
    doneOn[key].tasks += 1
  }

  const totalWorking = days.filter(d => isWorkingDay(d, weekendDays, holidayMap)).length

  const rows = []
  let workingConsumed = 0
  let cumPoints = 0
  let cumTasks = 0

  for (const date of days) {
    const weekend = isWeekendISO(date, weekendDays)
    const holiday = holidayMap && holidayMap[date] ? holidayMap[date] : null
    const working = isWorkingDay(date, weekendDays, holidayMap)
    if (working) workingConsumed++

    const ratio = totalWorking > 0 ? (totalWorking - workingConsumed) / totalWorking : 1
    const isFuture = !!(todayISO && date > todayISO)

    const day = doneOn[date] || { points: 0, tasks: 0 }
    if (!isFuture) { cumPoints += day.points; cumTasks += day.tasks }

    rows.push({
      date,
      label: `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`,
      isWeekend: weekend,
      // Mirrors the working-day maths: an 'optional' holiday is still a working day, so
      // the flag stays false even though holidayName is populated for it.
      isHoliday: isHolidayISO(date, holidayMap),
      holidayName: holiday ? (holiday.name || null) : null,
      isFuture,
      idealPoints: round1(totalPoints * ratio),
      idealTasks: round1(totalTasks * ratio),
      remainingPoints: isFuture ? null : round1(Math.max(0, totalPoints - cumPoints)),
      remainingTasks: isFuture ? null : Math.max(0, totalTasks - cumTasks),
      // Per-DAY completions, not a running total — the cumulative figure is already
      // implied by remainingPoints. Zero on future rows.
      completedPoints: isFuture ? 0 : round1(day.points),
      completedTasks: isFuture ? 0 : day.tasks,
    })
  }

  return rows
}

// ---------------------------------------------------------------------------
// Velocity
// ---------------------------------------------------------------------------

function median(values) {
  const v = values.filter(n => Number.isFinite(n)).slice().sort((a, b) => a - b)
  if (!v.length) return 0
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

function sprintOrderKey(s) {
  return toISODate(s && (s.endDate || s.completedAt || s.startDate || s.createdAt)) || ''
}

// Velocity is measured on COMPLETED sprints only — an in-flight sprint's partial total
// would drag every average down and make the forecast permanently pessimistic.
function buildVelocity({ sprints, tasksBySprint, weekendDays, holidayMap }) {
  const completed = (Array.isArray(sprints) ? sprints : [])
    .filter(s => s && s.status === 'completed')
    .slice()
    .sort((a, b) => (sprintOrderKey(a) < sprintOrderKey(b) ? -1 : sprintOrderKey(a) > sprintOrderKey(b) ? 1 : 0))

  const history = completed.map(s => {
    const tasks = (tasksBySprint && tasksBySprint[s.id]) || []
    let doneTasks = 0
    let donePoints = 0
    let totalPoints = 0
    for (const t of tasks) {
      const p = pointsOf(t)
      totalPoints += p
      if (isDone(t)) { doneTasks++; donePoints += p }
    }
    const startISO = toISODate(s.startDate)
    const endISO = toISODate(s.endDate)
    const workingDays = (startISO && endISO) ? countWorkingDays(startISO, endISO, weekendDays, holidayMap) : 0

    // Planned = the snapshot taken when the sprint went active, when there is one.
    // Without it the current membership is the only baseline available.
    const planned = Array.isArray(s.plannedTaskIds) ? s.plannedTaskIds : null
    const byId = {}
    for (const t of tasks) if (t && t.id) byId[t.id] = t
    const plannedTasksList = planned ? planned.map(id => byId[id]).filter(Boolean) : tasks
    const plannedPoints = plannedTasksList.reduce((n, t) => n + pointsOf(t), 0)

    return {
      sprintId: s.id || null,
      name: s.name || 'Untitled sprint',
      endDate: endISO,
      doneTasks,
      donePoints: round1(donePoints),
      plannedTasks: planned ? planned.length : tasks.length,
      plannedPoints: round1(plannedPoints),
      workingDays,
      pointsPerWorkingDay: workingDays > 0 ? round1(donePoints / workingDays) : round1(donePoints),
      capacityPoints: Number.isFinite(Number(s.capacityPoints)) && s.capacityPoints != null ? Number(s.capacityPoints) : null,
    }
  })

  const points = history.map(h => h.donePoints || 0)
  const taskCounts = history.map(h => h.doneTasks || 0)
  const averagePoints = points.length ? round1(points.reduce((a, b) => a + b, 0) / points.length) : 0
  const averageTasks = taskCounts.length ? round1(taskCounts.reduce((a, b) => a + b, 0) / taskCounts.length) : 0
  const lastPoints = points.length ? points[points.length - 1] : 0

  let trend = 'flat'
  if (points.length >= 2) {
    const prev = points[points.length - 2]
    if (prev === 0) trend = lastPoints > 0 ? 'up' : 'flat'
    else {
      const delta = (lastPoints - prev) / prev
      trend = delta > 0.05 ? 'up' : delta < -0.05 ? 'down' : 'flat'
    }
  }

  const last3 = points.slice(-3)
  const last3Tasks = taskCounts.slice(-3)

  return {
    history,
    averageTasks,
    averagePoints,
    medianPoints: round1(median(points)),
    lastPoints,
    trend,
    forecastPoints: last3.length ? round1(last3.reduce((a, b) => a + b, 0) / last3.length) : 0,
    forecastTasks: last3Tasks.length ? round1(last3Tasks.reduce((a, b) => a + b, 0) / last3Tasks.length) : 0,
  }
}

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

// sa-note: a task with several assignees credits EACH of them in full. Splitting the
// points would make every pair-programmed card look like half a card, and nobody
// reconciles a board to fractional credit. The consequence is that the team table's
// column totals can exceed the sprint totals — the UI surfaces this as a footnote.
function buildTeam({ tasks, workingDaysElapsed, today }) {
  const list = Array.isArray(tasks) ? tasks : []
  const todayISO = toISODate(today || new Date())
  const elapsed = Number(workingDaysElapsed) > 0 ? Number(workingDaysElapsed) : 0
  const byName = {}

  function slot(name) {
    if (!byName[name]) {
      byName[name] = {
        name,
        assignedTasks: 0,
        doneTasks: 0,
        inProgressTasks: 0,
        blockedTasks: 0,
        overdueTasks: 0,
        assignedPoints: 0,
        donePoints: 0,
        _onTimeEligible: 0,
        _onTimeHit: 0,
        _cycleSum: 0,
        _cycleN: 0,
      }
    }
    return byName[name]
  }

  for (const t of list) {
    const names = assigneesOf(t)
    if (!names.length) continue
    const p = pointsOf(t)
    const done = isDone(t)
    const due = toISODate(t && t.dueDate)
    const completed = toISODate(t && t.completedAt)
    const startRef = toISODate((t && t.createdAt) || (t && t.startDate))

    for (const name of names) {
      const m = slot(name)
      m.assignedTasks++
      m.assignedPoints += p
      if (done) { m.doneTasks++; m.donePoints += p }
      if (t && t.status === 'in-progress') m.inProgressTasks++
      if (t && t.status === 'blocked') m.blockedTasks++
      if (isOverdue(t, todayISO)) m.overdueTasks++
      if (done && due && completed) {
        m._onTimeEligible++
        if (completed <= due) m._onTimeHit++
      }
      // Legacy done tasks have no completedAt, so their cycle time is unknowable —
      // counting them as "0 days" would flatter every average.
      if (done && completed && startRef) {
        const d = daysBetween(startRef, completed)
        if (d != null && d >= 0) { m._cycleSum += d; m._cycleN++ }
      }
    }
  }

  return Object.values(byName)
    .map(m => finaliseMember(m, elapsed, 0))
    .sort((a, b) => (b.donePoints - a.donePoints) || (b.doneTasks - a.doneTasks) || a.name.localeCompare(b.name))
}

// Turns an accumulator into the wire shape. The running totals needed to merge members
// across sprints are attached non-enumerably, so they survive mergeTeam but never reach
// JSON.stringify and therefore never reach the response body.
function finaliseMember(acc, elapsed, sprintsParticipated) {
  const member = {
    name: acc.name,
    assignedTasks: acc.assignedTasks,
    doneTasks: acc.doneTasks,
    inProgressTasks: acc.inProgressTasks,
    blockedTasks: acc.blockedTasks,
    overdueTasks: acc.overdueTasks,
    assignedPoints: round1(acc.assignedPoints),
    donePoints: round1(acc.donePoints),
    completionRate: pct(acc.doneTasks, acc.assignedTasks),
    // Zero when nobody set a due date — same convention completionRate uses for an
    // empty denominator.
    onTimeRate: pct(acc._onTimeHit, acc._onTimeEligible),
    avgCycleTimeDays: acc._cycleN > 0 ? round1(acc._cycleSum / acc._cycleN) : null,
    throughputPerWorkingDay: elapsed > 0 ? round1(acc.donePoints / elapsed) : 0,
    sprintsParticipated,
  }
  Object.defineProperty(member, '_agg', {
    enumerable: false,
    value: {
      onTimeEligible: acc._onTimeEligible,
      onTimeHit: acc._onTimeHit,
      cycleSum: acc._cycleSum,
      cycleN: acc._cycleN,
      elapsed,
    },
  })
  return member
}

// Roll several per-sprint team lists into one all-time list. `sprintsParticipated` is the
// number of lists a name turned up in, so someone on four sprints reads as four even if
// three of them held a single task.
function mergeTeam(memberLists) {
  const lists = (Array.isArray(memberLists) ? memberLists : []).filter(l => Array.isArray(l))
  const byName = {}
  const elapsedByName = {}

  for (const list of lists) {
    for (const m of list) {
      if (!m || !m.name) continue
      const agg = m._agg || { onTimeEligible: 0, onTimeHit: 0, cycleSum: 0, cycleN: 0, elapsed: 0 }
      if (!byName[m.name]) {
        byName[m.name] = {
          name: m.name,
          assignedTasks: 0, doneTasks: 0, inProgressTasks: 0, blockedTasks: 0, overdueTasks: 0,
          assignedPoints: 0, donePoints: 0,
          _onTimeEligible: 0, _onTimeHit: 0, _cycleSum: 0, _cycleN: 0,
        }
        elapsedByName[m.name] = { sprints: 0, elapsed: 0 }
      }
      const a = byName[m.name]
      a.assignedTasks += m.assignedTasks || 0
      a.doneTasks += m.doneTasks || 0
      a.inProgressTasks += m.inProgressTasks || 0
      a.blockedTasks += m.blockedTasks || 0
      a.overdueTasks += m.overdueTasks || 0
      a.assignedPoints += m.assignedPoints || 0
      a.donePoints += m.donePoints || 0
      a._onTimeEligible += agg.onTimeEligible || 0
      a._onTimeHit += agg.onTimeHit || 0
      a._cycleSum += agg.cycleSum || 0
      a._cycleN += agg.cycleN || 0
      elapsedByName[m.name].sprints += 1
      elapsedByName[m.name].elapsed += agg.elapsed || 0
    }
  }

  return Object.values(byName)
    .map(a => finaliseMember(a, elapsedByName[a.name].elapsed, elapsedByName[a.name].sprints))
    .sort((a, b) => (b.donePoints - a.donePoints) || (b.doneTasks - a.doneTasks) || a.name.localeCompare(b.name))
}

module.exports = {
  // date helpers (pure, no Redis — the holiday module owns the stored versions)
  toISODate,
  parseISO,
  daysBetween,
  eachDate,
  isWeekendISO,
  isHolidayISO,
  isWorkingDay,
  countWorkingDays,
  MAX_BURNDOWN_ROWS,
  // task primitives
  pointsOf,
  hasExplicitPoints,
  isDone,
  completionDate,
  assigneesOf,
  isOverdue,
  // aggregates
  healthOf,
  summariseSprint,
  buildBurndown,
  buildVelocity,
  buildTeam,
  mergeTeam,
}
