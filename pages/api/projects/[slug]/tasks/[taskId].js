const { getTask, updateTask, deleteTask, reorderTask } = require('../../../../../lib/task-store');
const { logAudit } = require('../../../../../lib/audit-log');
const { requirePermission, requireProjectAccess } = require('../../../../../lib/require-permission');

export default async function handler(req, res) {
  const { slug, taskId, version } = req.query;
  if (!await requireProjectAccess(slug, req, res)) return;
  const v = version || null;

  if (req.method === 'GET') {
    const task = await getTask(slug, v, taskId);
    if (!task) return res.status(404).json({ error: 'Not found' });
    return res.status(200).json(task);
  }
  if (req.method === 'PUT') {
    if (!requirePermission('task:update')(req, res)) return;
    const updates = req.body || {};
    const before = await getTask(slug, v, taskId);
    if (!before) return res.status(404).json({ error: 'Not found' });
    const task = await updateTask(slug, v, taskId, updates);
    const details = { slug, version: v, taskId, fields: Object.keys(updates) };
    if ('status' in updates) { details.statusFrom = before.status; details.statusTo = updates.status; }
    await logAudit(req, 'update_task', 'task', details);
    return res.status(200).json(task);
  }
  if (req.method === 'DELETE') {
    if (!requirePermission('task:delete')(req, res)) return;
    const count = await deleteTask(slug, v, taskId);
    await logAudit(req, 'delete_task', 'task', { slug, version: v, taskId, deletedCount: count });
    return res.status(200).json({ deleted: count });
  }
  if (req.method === 'PATCH') {
    if (!requirePermission('task:update')(req, res)) return;
    const { direction } = req.body || {};
    const tasks = await reorderTask(slug, v, taskId, direction);
    if (!tasks) return res.status(404).json({ error: 'Not found' });
    await logAudit(req, 'reorder_task', 'task', { slug, version: v, taskId, direction });
    return res.status(200).json(tasks);
  }
  res.status(405).json({ error: 'Method not allowed' });
}
