// Work stats for one person or a team, from task records (server/api/teams.js,
// server/api/people/[name].js). Pure — the caller loads the tasks and decides which
// projects the viewer may see.
//
// Done dates: `completedAt`, else the QA pass time, else `updatedAt` — older tasks
// carry no completion stamp, so a later edit can move one into a newer week.
const DAY = 86400000

function names(list) {
  return (Array.isArray(list) ? list : []).map(a => (typeof a === 'object' ? a?.name : a)).filter(Boolean)
}
// Everyone on a task, including the legacy single `assignee` field.
function assigneesOf(t) {
  return names(t.assignees).concat(typeof t.assignee === 'string' && t.assignee ? [t.assignee] : [])
}
function dayStart(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime() }
function parseDue(v) {
  if (!v) return null
  const t = Date.parse(String(v).length === 10 ? `${v}T00:00:00` : v)
  return Number.isNaN(t) ? null : dayStart(t)
}
function doneAt(t) {
  return Date.parse(t.completedAt || (t.qa?.state === 'passed' ? t.qa.at : '') || t.updatedAt || t.createdAt || 0) || 0
}

function blank(weeks = 8) {
  return {
    open: 0, inProgress: 0, overdue: 0, dueSoon: 0, rework: 0, review: 0, blocked: 0,
    openPoints: 0, done30: 0, points30: 0, passed30: 0, firstPass30: 0,
    storiesDone30: 0, subtasksDone30: 0,
    dueDone30: 0, onTime30: 0, // finished in 30d with a due date / of those, by the due date
    sentBack30: 0, carryOver: 0, // QA rework verdicts on their stories in 30d / carry-overs on open stories
    cycle: [], // days from start (or creation) to done, finished in 30d — see finish()
    weekly: Array(weeks).fill(0), byStatus: {},
  }
}

function median(list) {
  if (!list.length) return null
  const s = [...list].sort((a, b) => a - b)
  return Math.round(s[Math.floor(s.length / 2)] * 10) / 10
}

// The JSON shape of a bucket: the raw cycle list becomes its median.
function finish(s) {
  const { cycle, ...rest } = s
  return { ...rest, cycleDaysMedian: median(cycle) }
}

// Adds one task to a stats bucket (from blank()).
function count(s, t, now) {
  const weeks = s.weekly.length
  const today = dayStart(now)
  const cutoff = now - 30 * DAY
  if (!t.parentId) s.sentBack30 += (t.qa?.log || []).filter(l => l.verdict === 'rework' && Date.parse(l.at || 0) >= cutoff).length
  if (t.status === 'done') {
    const at = doneAt(t)
    if (at >= cutoff) {
      s.done30++
      s.points30 += Number(t.points) || 0
      if (t.parentId) s.subtasksDone30++; else s.storiesDone30++
      if (!t.parentId && t.qa?.state === 'passed') {
        s.passed30++
        if (!(Number(t.qa.rounds) > 0)) s.firstPass30++
      }
      const due = parseDue(t.dueDate)
      if (due != null) { s.dueDone30++; if (dayStart(at) <= due) s.onTime30++ }
      const start = Date.parse(t.startDate || t.createdAt || 0)
      if (start && at >= start) s.cycle.push((at - start) / DAY)
    }
    const w = Math.floor((now - at) / (7 * DAY))
    if (w >= 0 && w < weeks) s.weekly[weeks - 1 - w]++
    return
  }
  s.open++
  s.openPoints += Number(t.points) || 0
  if (!t.parentId) s.carryOver += Number(t.carryOver) || 0
  s.byStatus[t.status] = (s.byStatus[t.status] || 0) + 1
  if (t.status === 'in-progress') s.inProgress++
  if (t.status === 'need-rework') s.rework++
  if (t.status === 'in-review') s.review++
  if (t.status === 'blocked') s.blocked++
  const due = parseDue(t.dueDate)
  if (due != null && due < today) s.overdue++
  else if (due != null && due <= today + 7 * DAY) s.dueSoon++
}

module.exports = { DAY, names, assigneesOf, dayStart, parseDue, doneAt, blank, count, finish, median }
