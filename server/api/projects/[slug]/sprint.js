const {
  getSprints, createSprint, updateSprint, addStories, removeStories, startSprint, completeSprint, deleteSprint,
  applyCadence, getSprintConfig, velocityOf, todayISO, resolveSprints,
} = require('../../../../lib/sprint-store')
const { listTasksByVersion } = require('../../../../lib/task-store')
const { requirePermission, requireProjectAccess, hasPermission } = require('../../../../lib/require-permission')
const { stripTasksMedia } = require('../../../../lib/task-media')
const { logAudit, getAuditUser } = require('../../../../lib/audit-log')
const { notifySprintEvents } = require('../../../../lib/sprint-notify')

// Sprints plan stories; see lib/sprint-store.js for the model and the lifecycle.
//
//   GET                       sprints (hydrated) + cadence config + velocity + caps
//   POST                      create a planned sprint (dates default to the cadence)
//   PUT    ?id=               edit name / goal / dates / capacity / review notes
//   PATCH  ?id=  { action }   start | complete | addStories | removeStories
//   DELETE ?id=               planned: admin; completed: super admin; active: never
//
// Every write needs `project:update` — sprints shape the whole team's plan, the same
// gate as epics.

function isSuper(user) {
  return user.role === 'superadmin' || (user.isAdmin === true && !user.role)
}

// Sprints embed task objects for the board. Stripped per version (attachment keys are
// version-scoped) and stamped with `version` so the board knows which route a card
// belongs to.
function buildTaskMap(groups, slug) {
  const map = {}
  for (const g of groups) {
    for (const t of stripTasksMedia(g.tasks, slug, g.version)) map[t.id] = { ...t, version: g.version }
  }
  return map
}

function hydrate(sprint, taskMap) {
  return {
    ...sprint,
    tasks: (sprint.taskIds || []).map(id => taskMap[id]).filter(Boolean),
    stories: (sprint.storyIds || []).map(id => taskMap[id]).filter(Boolean),
  }
}

function sendError(res, e) {
  if (e && e.code === 'SPRINT') return res.status(e.status).json({ error: e.message })
  if (e && (e.code === 'SPRINT_LOCK' || e.code === 'TASK_LOCK')) return res.status(503).json({ error: e.message })
  if (e && e.code === 'TASK_LIST_SIZE') return res.status(507).json({ error: e.message })
  throw e
}

export default async function handler(req, res) {
  const { slug, id } = req.query
  if (!await requireProjectAccess(slug, req, res)) return

  if (req.method === 'GET') {
    if (!await requirePermission('sprint:view', slug)(req, res)) return
    // The task lists load alongside the cadence check; they are reloaded only if the
    // cadence actually moved something (carry-over rewrites stories).
    let cadence = { events: [] }
    const groupsP = listTasksByVersion(slug)
    groupsP.catch(() => {}) // observed here; the real await below still sees a failure
    try {
      // The cadence is applied on read as well as by the cron, so a board opened on
      // Monday morning shows the new sprint even if the cron has not fired yet.
      cadence = await applyCadence(slug)
      const { events } = cadence
      if (events.length) {
        await logAudit(req, 'sprint_cadence', 'sprint', { slug, events: events.map(e => ({ type: e.type, sprintId: (e.completed || e.sprint)?.id })) })
        await notifySprintEvents(slug, events, null)
      }
    } catch (e) {
      // A busy lock or a transient failure must not take the sprint page down — the
      // next read or the cron will apply it.
      if (!(e && (e.code === 'SPRINT_LOCK' || e.code === 'TASK_LOCK'))) console.error('applyCadence failed', e)
    }
    const reuse = !cadence.events.length
    const groups = reuse ? await groupsP : await listTasksByVersion(slug)
    const [sprints, config, canManage] = await Promise.all([
      reuse && cadence.sprints ? resolveSprints(cadence.sprints, groups) : getSprints(slug, groups),
      reuse && cadence.config ? cadence.config : getSprintConfig(slug),
      hasPermission(req, 'project:update', slug),
    ])
    const taskMap = buildTaskMap(groups, slug)
    return res.status(200).json({
      sprints: sprints.map(s => hydrate(s, taskMap)),
      config,
      velocity: velocityOf(sprints),
      today: todayISO(),
      canManage,
      canDeleteCompleted: isSuper(getAuditUser(req) || {}),
    })
  }

  if (!await requirePermission('project:update', slug)(req, res)) return
  const actor = getAuditUser(req)?.name || null

  try {
    if (req.method === 'POST') {
      const sprint = await createSprint(slug, req.body || {})
      await logAudit(req, 'create_sprint', 'sprint', { slug, sprintId: sprint.id, name: sprint.name })
      return res.status(201).json(sprint)
    }

    if (!id) return res.status(400).json({ error: 'id is required' })

    if (req.method === 'PUT') {
      const sprint = await updateSprint(slug, id, req.body || {})
      if (!sprint) return res.status(404).json({ error: 'Sprint not found' })
      await logAudit(req, 'update_sprint', 'sprint', { slug, sprintId: id, fields: Object.keys(req.body || {}) })
      return res.status(200).json(sprint)
    }

    if (req.method === 'PATCH') {
      const body = req.body || {}
      if (body.action === 'start') {
        const { sprint, idx } = await startSprint(slug, id)
        await logAudit(req, 'start_sprint', 'sprint', { slug, sprintId: id, stories: sprint.storyIds.length })
        await notifySprintEvents(slug, [{ type: 'started', sprint, idx }], actor)
        return res.status(200).json(sprint)
      }
      if (body.action === 'complete') {
        const result = await completeSprint(slug, id, { review: body.review, actor })
        await logAudit(req, 'complete_sprint', 'sprint', {
          slug, sprintId: id, carried: result.carried.length, nextSprintId: result.next?.id || null, createdNext: result.createdNext,
        })
        await notifySprintEvents(slug, [{ type: 'completed', ...result }], actor)
        return res.status(200).json({ completed: result.completed, next: result.next, createdNext: result.createdNext, carried: result.carried.length })
      }
      if (body.action === 'addStories') {
        const result = await addStories(slug, id, body.storyIds)
        await logAudit(req, 'plan_sprint', 'sprint', { slug, sprintId: id, added: (body.storyIds || []).length, moved: result.moved.length })
        return res.status(200).json({ sprint: result.sprint, moved: result.moved })
      }
      if (body.action === 'removeStories') {
        const sprint = await removeStories(slug, id, body.storyIds)
        await logAudit(req, 'plan_sprint', 'sprint', { slug, sprintId: id, removed: (body.storyIds || []).length })
        return res.status(200).json(sprint)
      }
      return res.status(400).json({ error: 'Unknown action' })
    }

    if (req.method === 'DELETE') {
      const all = await getSprints(slug)
      const target = all.find(s => s.id === id)
      if (!target) return res.status(404).json({ error: 'Sprint not found' })
      // A completed sprint is history the velocity is built on — only a super admin may
      // erase it.
      if (target.status === 'completed' && !isSuper(getAuditUser(req) || {})) {
        return res.status(403).json({ error: 'Only a super admin can delete a completed sprint.' })
      }
      await deleteSprint(slug, id)
      await logAudit(req, 'delete_sprint', 'sprint', { slug, sprintId: id, status: target.status })
      return res.status(200).json({ ok: true })
    }
  } catch (e) {
    return sendError(res, e)
  }

  res.status(405).json({ error: 'Method not allowed' })
}
