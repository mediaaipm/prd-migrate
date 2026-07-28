const { Redis } = require('@upstash/redis');
let _kv;
function getKv() { if (!_kv) _kv = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN }); return _kv; }
const { listProjects, listProposals } = require('../../../lib/prd-store')
const { getAuditLogs } = require('../../../lib/audit-log')
const { getSprints } = require('../../../lib/sprint-store')
const { requirePermission, visibleProjects } = require('../../../lib/require-permission')

async function getTasksForProject(slug) {
  // Load root tasks + all version-scoped tasks
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

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  if (!await requirePermission('dashboard:view')(req, res)) return

  try {
    // Only roll up the projects this account is allowed to see.
    const projects = await visibleProjects(req, await listProjects())
    if (!projects.length) {
      return res.status(200).json({ overdue: [], unassigned: [], lastUpdates: [], upcoming: [], workload: [], completion: [], activeSprints: [] })
    }

    const [allTasksNested, allProposalsNested, allSprints] = await Promise.all([
      Promise.all(projects.map(p => getTasksForProject(p.slug))),
      Promise.all(projects.map(p => listProposals(p.slug))),
      Promise.all(projects.map(p => getSprints(p.slug))),
    ])

    const overdue = []
    const unassigned = []

    projects.forEach((project, i) => {
      const tasks = allTasksNested[i]
      const proposals = allProposalsNested[i]

      tasks.forEach(task => {
        if (task.status === 'done') return
        const assignees = Array.isArray(task.assignees) ? task.assignees.filter(Boolean) : []

        if (task.dueDate) {
          const due = new Date(task.dueDate)
          due.setHours(0, 0, 0, 0)
          if (due < today) {
            const daysOverdue = Math.round((today - due) / 86400000)
            overdue.push({
              type: 'task',
              id: task.id,
              title: task.title,
              dueDate: task.dueDate,
              daysOverdue,
              project: project.name,
              slug: project.slug,
              assignees,
              status: task.status,
            })
          }
        }

        if (assignees.length === 0) {
          unassigned.push({
            type: 'task',
            id: task.id,
            title: task.title,
            project: project.name,
            slug: project.slug,
            createdAt: task.createdAt || null,
          })
        }
      })

      proposals.forEach(proposal => {
        if (proposal.status !== 'pending') return

        if (proposal.dueDate) {
          const due = new Date(proposal.dueDate)
          due.setHours(0, 0, 0, 0)
          if (due < today) {
            const daysOverdue = Math.round((today - due) / 86400000)
            overdue.push({
              type: 'proposal',
              id: proposal.id,
              title: proposal.title,
              dueDate: proposal.dueDate,
              daysOverdue,
              project: project.name,
              slug: project.slug,
              assignees: proposal.assignee ? [proposal.assignee] : [],
              status: proposal.status,
            })
          }
        }

        if (!proposal.assignee) {
          unassigned.push({
            type: 'proposal',
            id: proposal.id,
            title: proposal.title,
            project: project.name,
            slug: project.slug,
            createdAt: proposal.createdAt || null,
          })
        }
      })
    })

    // Upcoming deadlines: due within 7 days (not overdue, not done)
    const upcoming = []
    const workloadMap = {}

    projects.forEach((project, i) => {
      const tasks = allTasksNested[i]
      const proposals = allProposalsNested[i]

      tasks.forEach(task => {
        if (task.status === 'done') return
        const assignees = Array.isArray(task.assignees) ? task.assignees.filter(Boolean) : []

        // Workload
        assignees.forEach(a => {
          workloadMap[a] = (workloadMap[a] || 0) + 1
        })

        // Upcoming
        if (task.dueDate) {
          const due = new Date(task.dueDate)
          due.setHours(0, 0, 0, 0)
          const daysUntil = Math.round((due - today) / 86400000)
          if (daysUntil >= 0 && daysUntil <= 7) {
            upcoming.push({
              type: 'task',
              title: task.title,
              dueDate: task.dueDate,
              daysUntil,
              project: project.name,
              slug: project.slug,
              assignees,
              status: task.status,
            })
          }
        }
      })

      proposals.forEach(proposal => {
        if (proposal.status !== 'pending') return
        if (proposal.assignee) {
          workloadMap[proposal.assignee] = (workloadMap[proposal.assignee] || 0) + 1
        }
        if (proposal.dueDate) {
          const due = new Date(proposal.dueDate)
          due.setHours(0, 0, 0, 0)
          const daysUntil = Math.round((due - today) / 86400000)
          if (daysUntil >= 0 && daysUntil <= 7) {
            upcoming.push({
              type: 'proposal',
              title: proposal.title,
              dueDate: proposal.dueDate,
              daysUntil,
              project: project.name,
              slug: project.slug,
              assignees: proposal.assignee ? [proposal.assignee] : [],
              status: proposal.status,
            })
          }
        }
      })
    })

    upcoming.sort((a, b) => a.daysUntil - b.daysUntil)

    const workload = Object.entries(workloadMap)
      .map(([assignee, count]) => ({ assignee, count }))
      .sort((a, b) => b.count - a.count)

    // Sort overdue by most days overdue first
    overdue.sort((a, b) => b.daysOverdue - a.daysOverdue)
    // Sort unassigned by oldest first
    unassigned.sort((a, b) => {
      if (!a.createdAt) return 1
      if (!b.createdAt) return -1
      return new Date(a.createdAt) - new Date(b.createdAt)
    })

    // Single audit log scan — reused for both lastUpdates and velocity
    const VELOCITY_SCAN = 1000
    const { logs } = await getAuditLogs({ limit: VELOCITY_SCAN })

    const lastBySlug = {}
    const slugSet = new Set(projects.map(p => p.slug))
    const nowMs = Date.now()
    const startOfToday = new Date(today)
    const dayOfWeek = startOfToday.getDay()
    const daysFromMon = (dayOfWeek + 6) % 7
    const thisWeekStart = new Date(startOfToday.getTime() - daysFromMon * 86400000)
    const lastWeekStart = new Date(thisWeekStart.getTime() - 7 * 86400000)
    let thisWeekDone = 0
    let lastWeekDone = 0

    for (const log of logs) {
      const slug = log.details?.slug
      if (slug && slugSet.has(slug) && !lastBySlug[slug]) {
        lastBySlug[slug] = {
          project: projects.find(p => p.slug === slug)?.name || slug,
          slug,
          action: log.action,
          user: log.user || null,
          timestamp: log.timestamp,
        }
      }
      if (log.action === 'update_task' && log.details?.statusTo === 'done') {
        const ts = log.timestamp ? new Date(log.timestamp).getTime() : 0
        if (ts >= thisWeekStart.getTime()) thisWeekDone++
        else if (ts >= lastWeekStart.getTime()) lastWeekDone++
      }
    }

    projects.forEach(p => {
      if (!lastBySlug[p.slug]) {
        lastBySlug[p.slug] = {
          project: p.name,
          slug: p.slug,
          action: null,
          user: null,
          timestamp: p.createdAt || null,
        }
      }
    })

    const lastUpdates = Object.values(lastBySlug).sort((a, b) => {
      if (!a.timestamp) return 1
      if (!b.timestamp) return -1
      return new Date(b.timestamp) - new Date(a.timestamp)
    })

    const completion = projects.map((project, i) => {
      const tasks = allTasksNested[i]
      const total = tasks.length
      const done = tasks.filter(t => t.status === 'done').length
      return {
        project: project.name,
        slug: project.slug,
        total,
        done,
        pct: total > 0 ? Math.round((done / total) * 100) : 0,
      }
    }).filter(c => c.total > 0).sort((a, b) => b.pct - a.pct)

    // Pending proposals backlog: projects ranked by number of pending proposals
    const pendingProposals = projects.map((project, i) => {
      const pending = allProposalsNested[i].filter(p => p.status === 'pending')
      return { project: project.name, slug: project.slug, count: pending.length }
    }).filter(p => p.count > 0).sort((a, b) => b.count - a.count)

    const velocity = { thisWeek: thisWeekDone, lastWeek: lastWeekDone }

    // Active sprints — one per project, only those with status 'active'
    const activeSprints = projects.reduce((acc, project, i) => {
      const sprint = (allSprints[i] || []).find(s => s.status === 'active')
      if (!sprint) return acc
      const tasks = allTasksNested[i]
      const taskMap = Object.fromEntries(tasks.map(t => [t.id, t]))
      const sprintTasks = (sprint.taskIds || []).map(id => taskMap[id]).filter(Boolean)
      const done  = sprintTasks.filter(t => t.status === 'done').length
      const total = sprintTasks.length
      const daysLeft = sprint.endDate
        ? Math.ceil((new Date(sprint.endDate).setHours(23, 59, 59, 999) - Date.now()) / 86400000)
        : null
      acc.push({
        project: project.name,
        slug: project.slug,
        sprintName: sprint.name,
        startDate: sprint.startDate || null,
        endDate: sprint.endDate || null,
        daysLeft,
        done,
        total,
        pct: total > 0 ? Math.round((done / total) * 100) : 0,
      })
      return acc
    }, [])

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60')
    return res.status(200).json({ overdue, unassigned, lastUpdates, upcoming, workload, completion, pendingProposals, velocity, activeSprints })
  } catch (err) {
    console.error('Dashboard API error:', err)
    return res.status(500).json({ error: 'Failed to load dashboard data' })
  }
}
