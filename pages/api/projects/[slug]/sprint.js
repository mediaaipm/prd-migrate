const { getSprints, saveSprint, deleteSprint } = require('../../../../lib/sprint-store')
const { listTasks } = require('../../../../lib/task-store')
const { requirePermission, requireProjectAccess } = require('../../../../lib/require-permission')
const { stripTasksMedia } = require('../../../../lib/task-media')

async function hydrate(sprint, taskMap, slug) {
  const tasks = (sprint.taskIds || []).map(id => taskMap[id]).filter(Boolean)
  // Sprints embed whole task objects; without this the board's sprint view
  // re-downloaded every attachment on every load.
  return { ...sprint, tasks: stripTasksMedia(tasks, slug, null) }
}

export default async function handler(req, res) {
  const { slug, id } = req.query
  if (!await requireProjectAccess(slug, req, res)) return

  if (req.method === 'GET') {
    if (!await requirePermission('sprint:view', slug)(req, res)) return
    const allTasks = await listTasks(slug, null)
    const taskMap = Object.fromEntries(allTasks.map(t => [t.id, t]))
    const sprints = await getSprints(slug)
    const hydrated = await Promise.all(sprints.map(s => hydrate(s, taskMap, slug)))
    return res.status(200).json(hydrated)
  }

  if (req.method === 'POST') {
    const { id: clientId, name, startDate, endDate, taskIds, status } = req.body || {}
    if (!name) return res.status(400).json({ error: 'name is required' })
    // saveSprint upserts on id, so honouring a client-supplied id makes a replayed
    // POST overwrite the same sprint instead of creating a duplicate.
    const sprint = {
      id: (typeof clientId === 'string' && /^[A-Za-z0-9_-]{4,64}$/.test(clientId)) ? clientId : `sprint-${Date.now()}`,
      name,
      startDate: startDate || null,
      endDate: endDate || null,
      taskIds: Array.isArray(taskIds) ? taskIds : [],
      status: status || 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    const allTasks = await listTasks(slug, null)
    const taskMap = Object.fromEntries(allTasks.map(t => [t.id, t]))
    await saveSprint(slug, sprint)
    return res.status(200).json(await hydrate(sprint, taskMap, slug))
  }

  if (req.method === 'PUT') {
    if (!id) return res.status(400).json({ error: 'id is required' })
    const sprints = await getSprints(slug)
    const existing = sprints.find(s => s.id === id)
    if (!existing) return res.status(404).json({ error: 'Sprint not found' })
    const { name, startDate, endDate, taskIds, status } = req.body || {}
    if (!name) return res.status(400).json({ error: 'name is required' })
    const updated = {
      ...existing,
      name,
      startDate: startDate || null,
      endDate: endDate || null,
      taskIds: Array.isArray(taskIds) ? taskIds : existing.taskIds,
      status: status || existing.status,
      updatedAt: new Date().toISOString(),
    }
    const allTasks = await listTasks(slug, null)
    const taskMap = Object.fromEntries(allTasks.map(t => [t.id, t]))
    await saveSprint(slug, updated)
    return res.status(200).json(await hydrate(updated, taskMap, slug))
  }

  if (req.method === 'DELETE') {
    if (!id) return res.status(400).json({ error: 'id is required' })
    await deleteSprint(slug, id)
    return res.status(200).json({ ok: true })
  }

  res.status(405).json({ error: 'Method not allowed' })
}
