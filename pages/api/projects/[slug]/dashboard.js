const { Redis } = require('@upstash/redis');
let _kv;
function getKv() { if (!_kv) _kv = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN }); return _kv; }
const { getProject, listProposals } = require('../../../../lib/prd-store')
const { getAuditLogs } = require('../../../../lib/audit-log')
const { getSprints } = require('../../../../lib/sprint-store')
const { requirePermission, requireProjectAccess } = require('../../../../lib/require-permission')

async function getTasksForProject(slug) {
  const versionIds = await getKv().smembers(`versions:${slug}`)
  const keys = [`tasks:${slug}:__root`, ...(versionIds || []).map(v => `tasks:${slug}:${v}`)]
  const results = await getKv().mget(...keys)
  const tasks = []
  results.forEach((arr, i) => {
    if (!Array.isArray(arr)) return
    arr.forEach(t => tasks.push({ ...t, _version: i === 0 ? '__root' : (versionIds[i - 1] || '') }))
  })
  return tasks
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const { slug } = req.query
  if (!await requireProjectAccess(slug, req, res)) return
  if (!await requirePermission('dashboard:view', slug)(req, res)) return

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  try {
    const [project, tasks, proposals, sprints] = await Promise.all([
      getProject(slug),
      getTasksForProject(slug),
      listProposals(slug),
      getSprints(slug),
    ])

    if (!project) return res.status(404).json({ error: 'Project not found' })

    // Overdue
    const overdue = []
    tasks.forEach(task => {
      if (task.status === 'done' || !task.dueDate) return
      const due = new Date(task.dueDate)
      due.setHours(0, 0, 0, 0)
      if (due < today) {
        overdue.push({
          type: 'task',
          id: task.id,
          title: task.title,
          dueDate: task.dueDate,
          daysOverdue: Math.round((today - due) / 86400000),
          assignees: Array.isArray(task.assignees) ? task.assignees.filter(Boolean) : [],
          status: task.status,
        })
      }
    })
    proposals.forEach(p => {
      if (p.status !== 'pending' || !p.dueDate) return
      const due = new Date(p.dueDate)
      due.setHours(0, 0, 0, 0)
      if (due < today) {
        overdue.push({
          type: 'proposal',
          id: p.id,
          title: p.title,
          dueDate: p.dueDate,
          daysOverdue: Math.round((today - due) / 86400000),
          assignees: p.assignee ? [p.assignee] : [],
          status: p.status,
        })
      }
    })
    overdue.sort((a, b) => b.daysOverdue - a.daysOverdue)

    // Upcoming (7 days)
    const upcoming = []
    tasks.forEach(task => {
      if (task.status === 'done' || !task.dueDate) return
      const due = new Date(task.dueDate)
      due.setHours(0, 0, 0, 0)
      const daysUntil = Math.round((due - today) / 86400000)
      if (daysUntil >= 0 && daysUntil <= 7) {
        upcoming.push({
          type: 'task',
          id: task.id,
          title: task.title,
          dueDate: task.dueDate,
          daysUntil,
          assignees: Array.isArray(task.assignees) ? task.assignees.filter(Boolean) : [],
          status: task.status,
        })
      }
    })
    proposals.forEach(p => {
      if (p.status !== 'pending' || !p.dueDate) return
      const due = new Date(p.dueDate)
      due.setHours(0, 0, 0, 0)
      const daysUntil = Math.round((due - today) / 86400000)
      if (daysUntil >= 0 && daysUntil <= 7) {
        upcoming.push({
          type: 'proposal',
          id: p.id,
          title: p.title,
          dueDate: p.dueDate,
          daysUntil,
          assignees: p.assignee ? [p.assignee] : [],
          status: p.status,
        })
      }
    })
    upcoming.sort((a, b) => a.daysUntil - b.daysUntil)

    // Unassigned
    const unassigned = []
    tasks.forEach(task => {
      if (task.status === 'done') return
      const assignees = Array.isArray(task.assignees) ? task.assignees.filter(Boolean) : []
      if (assignees.length === 0) {
        unassigned.push({ type: 'task', id: task.id, title: task.title, createdAt: task.createdAt || null })
      }
    })
    proposals.forEach(p => {
      if (p.status !== 'pending') return
      if (!p.assignee) {
        unassigned.push({ type: 'proposal', id: p.id, title: p.title, createdAt: p.createdAt || null })
      }
    })
    unassigned.sort((a, b) => {
      if (!a.createdAt) return 1
      if (!b.createdAt) return -1
      return new Date(a.createdAt) - new Date(b.createdAt)
    })

    // Workload
    const workloadMap = {}
    tasks.forEach(task => {
      if (task.status === 'done') return
      const assignees = Array.isArray(task.assignees) ? task.assignees.filter(Boolean) : []
      assignees.forEach(a => { workloadMap[a] = (workloadMap[a] || 0) + 1 })
    })
    proposals.forEach(p => {
      if (p.status !== 'pending' || !p.assignee) return
      workloadMap[p.assignee] = (workloadMap[p.assignee] || 0) + 1
    })
    const workload = Object.entries(workloadMap)
      .map(([assignee, count]) => ({ assignee, count }))
      .sort((a, b) => b.count - a.count)

    // Completion
    const total = tasks.length
    const done = tasks.filter(t => t.status === 'done').length
    const completion = { total, done, pct: total > 0 ? Math.round((done / total) * 100) : 0 }

    // Status breakdown
    const statusCounts = {}
    tasks.forEach(t => { statusCounts[t.status] = (statusCounts[t.status] || 0) + 1 })

    // Pending proposals
    const pendingProposals = proposals.filter(p => p.status === 'pending').length

    // Active sprint
    const activeSprint = (sprints || []).find(s => s.status === 'active') || null
    let sprintStats = null
    if (activeSprint) {
      const taskMap = Object.fromEntries(tasks.map(t => [t.id, t]))
      const sprintTasks = (activeSprint.taskIds || []).map(id => taskMap[id]).filter(Boolean)
      const sprintDone = sprintTasks.filter(t => t.status === 'done').length
      const daysLeft = activeSprint.endDate
        ? Math.ceil((new Date(activeSprint.endDate).setHours(23, 59, 59, 999) - Date.now()) / 86400000)
        : null
      sprintStats = {
        name: activeSprint.name,
        startDate: activeSprint.startDate || null,
        endDate: activeSprint.endDate || null,
        daysLeft,
        done: sprintDone,
        total: sprintTasks.length,
        pct: sprintTasks.length > 0 ? Math.round((sprintDone / sprintTasks.length) * 100) : 0,
      }
    }

    // Velocity (audit log)
    const startOfToday = new Date(today)
    const dayOfWeek = startOfToday.getDay()
    const daysFromMon = (dayOfWeek + 6) % 7
    const thisWeekStart = new Date(startOfToday.getTime() - daysFromMon * 86400000)
    const lastWeekStart = new Date(thisWeekStart.getTime() - 7 * 86400000)
    let thisWeekDone = 0
    let lastWeekDone = 0
    try {
      const { logs } = await getAuditLogs({ limit: 500 })
      for (const log of logs) {
        if (log.action === 'update_task' && log.details?.slug === slug && log.details?.statusTo === 'done') {
          const ts = log.timestamp ? new Date(log.timestamp).getTime() : 0
          if (ts >= thisWeekStart.getTime()) thisWeekDone++
          else if (ts >= lastWeekStart.getTime()) lastWeekDone++
        }
      }
    } catch {}
    const velocity = { thisWeek: thisWeekDone, lastWeek: lastWeekDone }

    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=30')
    return res.status(200).json({
      project: { name: project.name, slug: project.slug, description: project.description },
      completion,
      statusCounts,
      pendingProposals,
      activeSprint: sprintStats,
      overdue,
      upcoming,
      unassigned,
      workload,
      velocity,
    })
  } catch (err) {
    console.error('Project dashboard error:', err)
    return res.status(500).json({ error: 'Failed to load dashboard' })
  }
}
