const { getSprints, saveSprint, deleteSprint } = require('../../../../lib/sprint-store')
const { listTasksByVersion } = require('../../../../lib/task-store')
const { requirePermission, requireProjectAccess } = require('../../../../lib/require-permission')
const { stripTasksMedia } = require('../../../../lib/task-media')
const { logAudit } = require('../../../../lib/audit-log')

const MAX_GOAL = 500

// Sprints are project-wide but tasks are stored one list per version, so the map has
// to span every version — hydrating from the __root list alone made a sprint whose
// tasks were picked on a version tab render as empty.
// stripTasksMedia is per-version (attachment keys are version-scoped), so each list is
// stripped with its own version before being merged.
async function buildTaskMap(slug) {
  const groups = await listTasksByVersion(slug)
  const map = {}
  for (const g of groups) {
    // Sprints embed whole task objects; without the strip the board's sprint view
    // re-downloaded every attachment on every load.
    //
    // `version` is stamped on the embedded copy only (tasks are stored without it):
    // a sprint spans every version list, and the sprint board has to know which
    // task route a card belongs to before it can move it.
    for (const t of stripTasksMedia(g.tasks, slug, g.version)) map[t.id] = { ...t, version: g.version }
  }
  return map
}

function hydrate(sprint, taskMap) {
  return { ...sprint, tasks: (sprint.taskIds || []).map(id => taskMap[id]).filter(Boolean) }
}

function normGoal(v) {
  if (typeof v !== 'string') return ''
  return v.trim().slice(0, MAX_GOAL)
}

// Planned capacity in the same unit as task points. Blank/garbage means "not set",
// which the analytics layer renders as no capacity line rather than a zero one.
function normCapacity(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.min(100000, Math.round(n * 10) / 10)
}

// Lifecycle stamps. These are the timestamps the analytics endpoint measures against,
// so they are derived from the status transition and never taken from the request body:
//
//   startedAt      first time the sprint goes 'active'      — never overwritten
//   plannedTaskIds the membership at that same moment       — stamped once, the scope
//                                                             baseline for scope-change
//   completedAt    first time it goes 'completed'           — cleared if it is reopened
//
// `prev` is null on create.
function applyLifecycle(next, prev) {
  const now = new Date().toISOString()

  if (next.status === 'active') {
    if (!next.startedAt) next.startedAt = now
    // `== null` on purpose: a sprint that went active with nothing in it snapshots an
    // empty baseline, and every task added afterwards is honestly reported as scope
    // added rather than silently re-baselined.
    if (next.plannedTaskIds == null) next.plannedTaskIds = [...(next.taskIds || [])]
  } else if (!next.startedAt && prev && prev.startedAt) {
    next.startedAt = prev.startedAt
  }

  if (next.status === 'completed') {
    if (!next.completedAt) next.completedAt = now
  } else if (next.completedAt) {
    // Reopened. The old completion timestamp would make the sprint look finished in
    // every velocity chart it appears in.
    next.completedAt = null
  }

  if (next.startedAt === undefined) next.startedAt = null
  if (next.completedAt === undefined) next.completedAt = null
  if (next.plannedTaskIds === undefined) next.plannedTaskIds = null
  return next
}

export default async function handler(req, res) {
  const { slug, id } = req.query
  if (!await requireProjectAccess(slug, req, res)) return

  if (req.method === 'GET') {
    if (!await requirePermission('sprint:view', slug)(req, res)) return
    const [taskMap, sprints] = await Promise.all([buildTaskMap(slug), getSprints(slug)])
    return res.status(200).json(sprints.map(s => hydrate(s, taskMap)))
  }

  if (req.method === 'POST') {
    const { id: clientId, name, startDate, endDate, taskIds, status, goal, capacityPoints } = req.body || {}
    if (!name) return res.status(400).json({ error: 'name is required' })
    // saveSprint upserts on id, so honouring a client-supplied id makes a replayed
    // POST overwrite the same sprint instead of creating a duplicate.
    const sprint = applyLifecycle({
      id: (typeof clientId === 'string' && /^[A-Za-z0-9_-]{4,64}$/.test(clientId)) ? clientId : `sprint-${Date.now()}`,
      name,
      goal: normGoal(goal),
      startDate: startDate || null,
      endDate: endDate || null,
      capacityPoints: normCapacity(capacityPoints),
      taskIds: Array.isArray(taskIds) ? taskIds : [],
      status: status || 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, null)
    const taskMap = await buildTaskMap(slug)
    await saveSprint(slug, sprint)
    await logAudit(req, 'create_sprint', 'sprint', { slug, sprintId: sprint.id, name: sprint.name, status: sprint.status })
    return res.status(200).json(hydrate(sprint, taskMap))
  }

  if (req.method === 'PUT') {
    if (!id) return res.status(400).json({ error: 'id is required' })
    const sprints = await getSprints(slug)
    const existing = sprints.find(s => s.id === id)
    if (!existing) return res.status(404).json({ error: 'Sprint not found' })
    const body = req.body || {}
    const { name, startDate, endDate, taskIds, status } = body
    if (!name) return res.status(400).json({ error: 'name is required' })
    const updated = applyLifecycle({
      ...existing,
      name,
      // Both fields are optional on the wire: a client that predates them must not
      // wipe a goal or a capacity it never knew about.
      goal: 'goal' in body ? normGoal(body.goal) : normGoal(existing.goal),
      startDate: startDate || null,
      endDate: endDate || null,
      capacityPoints: 'capacityPoints' in body ? normCapacity(body.capacityPoints) : normCapacity(existing.capacityPoints),
      taskIds: Array.isArray(taskIds) ? taskIds : existing.taskIds,
      status: status || existing.status,
      updatedAt: new Date().toISOString(),
    }, existing)
    const taskMap = await buildTaskMap(slug)
    await saveSprint(slug, updated)
    await logAudit(req, 'update_sprint', 'sprint', {
      slug, sprintId: id, name: updated.name,
      statusFrom: existing.status, statusTo: updated.status,
    })
    return res.status(200).json(hydrate(updated, taskMap))
  }

  if (req.method === 'DELETE') {
    if (!id) return res.status(400).json({ error: 'id is required' })
    await deleteSprint(slug, id)
    await logAudit(req, 'delete_sprint', 'sprint', { slug, sprintId: id })
    return res.status(200).json({ ok: true })
  }

  res.status(405).json({ error: 'Method not allowed' })
}
