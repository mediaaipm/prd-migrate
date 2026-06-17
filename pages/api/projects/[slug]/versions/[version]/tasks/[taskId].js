const { getTask, updateTask, deleteTask, reorderTask, moveTask } = require('../../../../../../../lib/task-store');
const { logAudit } = require('../../../../../../../lib/audit-log');
const { requireAdmin } = require('../../../../../../../lib/require-admin');
const { requireProjectAccess } = require('../../../../../../../lib/require-permission');

export default async function handler(req, res) {
  const { slug, version, taskId } = req.query;
  if (!await requireProjectAccess(slug, req, res)) return;

  if (req.method === 'GET') {
    const task = await getTask(slug, version, taskId);
    if (!task) return res.status(404).json({ error: 'Not found' });
    return res.status(200).json(task);
  }
  if (req.method === 'PUT') {
    const updates = req.body || {};
    const task = await updateTask(slug, version, taskId, updates);
    if (!task) return res.status(404).json({ error: 'Not found' });
    await logAudit(req, 'update_task', 'task', { slug, version, taskId, fields: Object.keys(updates) });
    return res.status(200).json(task);
  }
  if (req.method === 'DELETE') {
    if (!requireAdmin(req, res)) return;
    const count = await deleteTask(slug, version, taskId);
    await logAudit(req, 'delete_task', 'task', { slug, version, taskId, deletedCount: count });
    return res.status(200).json({ deleted: count });
  }
  if (req.method === 'PATCH') {
    const { direction, action, targetId, position } = req.body || {};
    if (action === 'move') {
      const tasks = await moveTask(slug, version, taskId, targetId, position);
      if (!tasks) return res.status(404).json({ error: 'Not found' });
      await logAudit(req, 'move_task', 'task', { slug, version, taskId, targetId, position });
      return res.status(200).json(tasks);
    }
    const tasks = await reorderTask(slug, version, taskId, direction);
    if (!tasks) return res.status(404).json({ error: 'Not found' });
    await logAudit(req, 'reorder_task', 'task', { slug, version, taskId, direction });
    return res.status(200).json(tasks);
  }
  res.status(405).json({ error: 'Method not allowed' });
}
