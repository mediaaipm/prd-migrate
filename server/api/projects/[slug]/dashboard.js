const { getProjectMeta } = require('../../../../lib/prd-store')
const { listTasksByVersion } = require('../../../../lib/task-store')
const { getSprints, todayISO } = require('../../../../lib/sprint-store')
const { listEpics } = require('../../../../lib/epic-store')
const { requirePermission, requireProjectAccess, hasPermission } = require('../../../../lib/require-permission')
const { sendJsonCached } = require('../../../../lib/etag')

// Insights: one read-only summary of a project, built around stories (root tasks),
// the current sprint, sprint history and epics. Every date compares as a YYYY-MM-DD
// string in the sprint timezone, so "overdue" agrees with the sprint calendar.

const DAY = 86400000
const isISO = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)
const dayNum = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY
const daysBetween = (from, to) => Math.round(dayNum(to) - dayNum(from))
const pts = t => (Number.isFinite(t.points) && t.points > 0 ? t.points : 1)
const people = t => (Array.isArray(t.assignees) ? t.assignees.filter(Boolean) : [])
const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : 0)

// Same label the board shows: PREFIX-seq when the project has a prefix, else #number.
function label(t, prefix) {
  return prefix && t.seq != null ? `${prefix}-${t.seq}` : (t.number ? `#${t.number}` : '')
}

// Points still open on each day of the sprint, from each item's completedAt. Scope is
// the sprint as it stands now (work added mid-sprint counts from day one). Future days
// carry only the ideal line.
function burndown(sprint, items, today) {
  if (!isISO(sprint.startDate) || !isISO(sprint.endDate)) return null
  const start = sprint.startDate.slice(0, 10)
  const end = sprint.endDate.slice(0, 10)
  const span = daysBetween(start, end)
  if (span < 0 || span > 120) return null
  const total = items.reduce((n, t) => n + pts(t), 0)
  const doneOn = items
    .filter(t => t.status === 'done')
    .map(t => ({ day: isISO(t.completedAt) ? t.completedAt.slice(0, 10) : today, p: pts(t) }))
  const days = []
  for (let i = 0; i <= span; i++) {
    const date = new Date((dayNum(start) + i) * DAY).toISOString().slice(0, 10)
    const ideal = Math.round((total * (1 - i / Math.max(1, span))) * 10) / 10
    const remaining = date <= today ? total - doneOn.filter(d => d.day <= date).reduce((n, d) => n + d.p, 0) : null
    days.push({ date, ideal, remaining })
  }
  return { total, days }
}

function row(t) {
  return {
    id: t.id,
    title: t.title,
    number: label(t, t._prefix),
    version: t._version,
    isStory: !t.parentId,
    status: t.status,
    assignees: people(t),
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const { slug } = req.query
  if (!await requireProjectAccess(slug, req, res)) return
  if (!await requirePermission('dashboard:view', slug)(req, res)) return

  try {
    const [project, groups, canSprints, canTasks] = await Promise.all([
      getProjectMeta(slug),
      listTasksByVersion(slug),
      hasPermission(req, 'sprint:view', slug),
      hasPermission(req, 'task:view', slug),
    ])
    if (!project) return res.status(404).json({ error: 'Project not found' })

    const [sprints, epics] = await Promise.all([
      canSprints ? getSprints(slug, groups) : [],
      canTasks ? listEpics(slug, groups) : [],
    ])

    const today = todayISO()
    const tasks = []
    for (const g of groups) for (const t of g.tasks) if (!t.archived) tasks.push({ ...t, _version: g.version, _prefix: project.taskPrefix || '' })
    const byId = Object.fromEntries(tasks.map(t => [t.id, t]))
    const stories = tasks.filter(t => !t.parentId)
    const open = tasks.filter(t => t.status !== 'done')

    // Story pipeline
    const byStatus = {}
    stories.forEach(s => { byStatus[s.status] = (byStatus[s.status] || 0) + 1 })
    const storiesDone = byStatus.done || 0
    const storySummary = { total: stories.length, done: storiesDone, pct: pct(storiesDone, stories.length), byStatus }
    const taskSummary = { total: tasks.length, done: tasks.length - open.length }

    // Deadlines (open work only)
    const overdue = []
    const upcoming = []
    open.forEach(t => {
      if (!isISO(t.dueDate)) return
      const d = daysBetween(today, t.dueDate.slice(0, 10))
      if (d < 0) overdue.push({ ...row(t), dueDate: t.dueDate, daysOverdue: -d })
      else if (d <= 7) upcoming.push({ ...row(t), dueDate: t.dueDate, daysUntil: d })
    })
    overdue.sort((a, b) => b.daysOverdue - a.daysOverdue)
    upcoming.sort((a, b) => a.daysUntil - b.daysUntil)

    // Stories that keep rolling from sprint to sprint
    const slipping = stories
      .filter(s => s.status !== 'done' && (Number(s.carryOver) || 0) >= 2)
      .map(s => ({ ...row(s), carryOver: Number(s.carryOver) }))
      .sort((a, b) => b.carryOver - a.carryOver)

    // Workload: open work per person, with how much of it is late
    const load = {}
    open.forEach(t => {
      const late = isISO(t.dueDate) && t.dueDate.slice(0, 10) < today
      people(t).forEach(p => {
        const w = (load[p] = load[p] || { assignee: p, open: 0, overdue: 0 })
        w.open++
        if (late) w.overdue++
      })
    })
    const workload = Object.values(load).sort((a, b) => b.open - a.open)

    // Current sprint — live status is right here: it is still running.
    let sprint = null
    const active = sprints.find(s => s.status === 'active')
    if (active) {
      const items = (active.taskIds || []).map(id => byId[id]).filter(Boolean)
      const sStories = items.filter(t => !t.parentId)
      const done = items.filter(t => t.status === 'done')
      const total = isISO(active.startDate) && isISO(active.endDate) ? daysBetween(active.startDate, active.endDate) + 1 : null
      const elapsed = total ? Math.min(total, Math.max(0, daysBetween(active.startDate, today) + 1)) : null
      sprint = {
        id: active.id,
        name: active.name,
        goal: active.goal || '',
        startDate: active.startDate || null,
        endDate: active.endDate || null,
        daysLeft: isISO(active.endDate) ? daysBetween(today, active.endDate) : null,
        startsIn: isISO(active.startDate) && active.startDate > today ? daysBetween(today, active.startDate) : 0,
        timePct: total ? pct(elapsed, total) : null,
        stories: sStories.length,
        storiesDone: sStories.filter(t => t.status === 'done').length,
        tasks: items.length,
        tasksDone: done.length,
        pct: pct(done.length, items.length),
        points: items.reduce((n, t) => n + pts(t), 0),
        pointsDone: done.reduce((n, t) => n + pts(t), 0),
        capacity: active.capacityPoints ?? null,
        carriedIn: (active.carriedInStoryIds || []).filter(id => byId[id]).length,
        unassigned: items.filter(t => t.status !== 'done' && !people(t).length).map(row),
        burndown: burndown(active, items, today),
      }
    }

    // Sprint history from the frozen summaries — never moves after a sprint closes.
    const history = sprints
      .filter(s => s.status === 'completed' && s.summary)
      .sort((a, b) => String(a.endDate || a.completedAt).localeCompare(String(b.endDate || b.completedAt)))
      .slice(-6)
      .map(s => ({
        id: s.id,
        name: s.name,
        endDate: s.endDate || null,
        committed: s.summary.committedStories || 0,
        added: s.summary.addedStories || 0,
        completed: s.summary.completedStories || 0,
        carried: s.summary.carriedStories || 0,
        completedPoints: s.summary.completedPoints || 0,
        totalPoints: s.summary.totalPoints || 0,
      }))
    const last3 = history.slice(-3)
    const velocity = last3.length
      ? {
          avg: Math.round((last3.reduce((n, h) => n + h.completedPoints, 0) / last3.length) * 10) / 10,
          last: history[history.length - 1].completedPoints,
          prev: history.length > 1 ? history[history.length - 2].completedPoints : null,
        }
      : null

    // Epics still in flight, soonest target first.
    const epicRows = epics
      .filter(e => e.status !== 'done')
      .map(e => ({
        id: e.id,
        name: e.name,
        color: e.color || null,
        status: e.status,
        targetDate: e.targetDate || null,
        stories: e.progress.stories,
        storiesDone: e.progress.storiesDone,
        pct: pct(e.progress.storiesDone, e.progress.stories),
        late: isISO(e.targetDate) && e.targetDate < today,
      }))
      .sort((a, b) => (a.targetDate || '9999').localeCompare(b.targetDate || '9999'))

    // QA review (lib/qa-store.js): what is waiting, what came back, and how often a
    // story passes first time (passed in the last 30 days with no rework round).
    const qaWindow = new Date(Date.now() - 30 * DAY).toISOString()
    const waiting = stories.filter(s => s.status === 'in-review')
    const passed30 = stories.filter(s => s.status === 'done' && s.qa?.state === 'passed' && String(s.qa.at || '') >= qaWindow)
    const oldest = waiting
      .map(s => ({ ...row(s), since: s.qa?.submittedAt || null }))
      .sort((a, b) => String(a.since || '9').localeCompare(String(b.since || '9')))[0] || null
    const qa = {
      waiting: waiting.length,
      rework: stories.filter(s => s.status === 'need-rework').length,
      passed: passed30.length,
      firstPass: passed30.filter(s => !(Number(s.qa.rounds) > 0)).length,
      reworkRounds: passed30.reduce((n, s) => n + (Number(s.qa.rounds) || 0), 0),
      oldest,
    }

    // `private`, never `s-maxage`: the response is per-user (ACL-filtered).
    return sendJsonCached(req, res, {
      project: { name: project.name, slug: project.slug, description: project.description },
      today,
      can: { sprints: canSprints, epics: canTasks },
      stories: storySummary,
      tasks: taskSummary,
      sprint,
      history,
      velocity,
      epics: epicRows,
      overdue,
      upcoming,
      slipping,
      workload,
      qa,
    })
  } catch (err) {
    console.error('Project insights error:', err)
    return res.status(500).json({ error: 'Failed to load insights' })
  }
}
