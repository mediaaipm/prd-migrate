const { requireProjectAccess, requirePermission, hasPermission } = require('../../../../lib/require-permission')
const { logAudit, getAuditUser } = require('../../../../lib/audit-log')
const { recordTaskUpdate, recordTaskHistory } = require('../../../../lib/task-history-store')
const { getSessionUser } = require('../../../../lib/session')
const { isLeadUser } = require('../../../../lib/roles')
const { qaQueue, qaVerdict, notifyVerdict, QaError } = require('../../../../lib/qa-store')

// The QA board (lib/qa-store.js).
//   GET   stories waiting for QA, sent back for rework, passed in the last 14 days.
//         Anyone who can see the project's tasks.
//   POST  { taskId, version, verdict: 'pass'|'rework', note, allowUnmet }
//         needs qa:review. Pass → Done; rework → Rework on the current sprint.
export default async function handler(req, res) {
  const { slug } = req.query
  if (!await requireProjectAccess(slug, req, res)) return

  if (req.method === 'GET') {
    if (!await requirePermission('task:view', slug)(req, res)) return
    const [queue, canReview] = await Promise.all([qaQueue(slug), hasPermission(req, 'qa:review', slug)])
    return res.status(200).json({ ...queue, canReview })
  }

  if (req.method === 'POST') {
    if (!await requirePermission('qa:review', slug)(req, res)) return
    const body = req.body || {}
    if (typeof body.taskId !== 'string' || !body.taskId) return res.status(400).json({ error: 'taskId required' })
    const me = getSessionUser(req) || {}
    const actor = getAuditUser(req)
    let out
    try {
      out = await qaVerdict(slug, {
        taskId: body.taskId,
        version: typeof body.version === 'string' && body.version ? body.version : null,
        verdict: body.verdict,
        note: body.note,
        allowUnmet: body.allowUnmet === true,
      }, { name: actor?.name || me.name, lead: isLeadUser(me) })
    } catch (e) {
      if (e instanceof QaError) return res.status(e.status).json({ error: e.message, code: e.code, unmet: e.unmet })
      if (e && e.code === 'TASK_CONFLICT') return res.status(409).json({ error: e.message })
      if (e && e.code === 'TASK_LOCK') return res.status(503).json({ error: e.message })
      throw e
    }
    const { task, before, cascaded, placement, note } = out
    const v = typeof body.version === 'string' && body.version ? body.version : null
    const verdict = body.verdict
    await Promise.all([
      recordTaskUpdate(slug, v, task.id, actor, before, { status: task.status }),
      recordTaskHistory(slug, v, task.id, { action: verdict === 'pass' ? 'qa_passed' : 'qa_rework', actor, meta: { note: note || null } }),
      ...cascaded.map(c => recordTaskUpdate(slug, v, c.id, actor, c.before, { status: 'done' })),
    ])
    await logAudit(req, verdict === 'pass' ? 'qa_pass' : 'qa_rework', 'task', {
      slug, version: v, taskId: task.id, title: task.title, note: note || undefined,
      sprint: placement?.sprint?.id, cascadedTaskIds: cascaded.length ? cascaded.map(c => c.id) : undefined,
    })
    await notifyVerdict(slug, v, before, verdict, actor?.name || me.name, note || '')
    return res.status(200).json({
      ok: true,
      status: task.status,
      closedSubtasks: cascaded.length,
      sprint: placement?.sprint || null,
      movedToSprint: !!placement?.moved,
      sprintNote: placement?.reason || null,
    })
  }

  res.status(405).end()
}
