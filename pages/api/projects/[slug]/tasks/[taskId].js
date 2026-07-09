const { getTask, updateTask, deleteTask, reorderTask, moveTask, restorePositions, reorderBoard } = require('../../../../../lib/task-store');
const { logAudit, getAuditUser } = require('../../../../../lib/audit-log');
const { recordTaskUpdate } = require('../../../../../lib/task-history-store');
const { notifyTaskChange } = require('../../../../../lib/notification-store');
const { requirePermission, requireProjectAccess, hasPermission, isAssignee, assigneeStatusAllowed } = require('../../../../../lib/require-permission');
const { requireSuperAdmin } = require('../../../../../lib/require-superadmin');
const { getProject } = require('../../../../../lib/prd-store');

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
    const updates = req.body || {};
    const before = await getTask(slug, v, taskId);
    if (!before) return res.status(404).json({ error: 'Not found' });
    // Regular users may change ONLY the status of tasks they're on (subject to the
    // project ACL). Full edits require task:update — held by subadmins/superadmin.
    const statusOnly = Object.keys(updates).length > 0 && Object.keys(updates).every(k => k === 'status');
    let allowed = hasPermission(req, 'task:update');
    if (!allowed && statusOnly && isAssignee(req, before)) {
      const project = await getProject(slug);
      allowed = assigneeStatusAllowed(project?.taskAcl, updates.status);
    }
    if (!allowed) return res.status(403).json({ error: 'Permission denied: task:update' });
    // Changing a task's display id is an admin-level action.
    if ('seq' in updates && !hasPermission(req, 'task:update')) {
      return res.status(403).json({ error: 'Permission denied: task:update' });
    }
    // Flag/unflag the task for repeated delay reminders (see /api/cron/delayed-reminders).
    if ('dueDate' in updates) {
      updates.dueDelayed = !!(before.dueDate && updates.dueDate && new Date(updates.dueDate) > new Date(before.dueDate));
    }
    if (updates.status === 'done') updates.dueDelayed = false;
    let task;
    try {
      task = await updateTask(slug, v, taskId, updates);
    } catch (e) {
      if (e && e.code === 'TASK_ID') return res.status(409).json({ error: e.message });
      throw e;
    }
    const details = { slug, version: v, taskId, fields: Object.keys(updates) };
    if ('status' in updates) { details.statusFrom = before.status; details.statusTo = updates.status; }
    await logAudit(req, 'update_task', 'task', details);
    await recordTaskUpdate(slug, v, taskId, getAuditUser(req), before, updates);
    await notifyTaskChange(getAuditUser(req)?.name, { slug, version: v, before, updates });
    return res.status(200).json(task);
  }
  if (req.method === 'DELETE') {
    // Deletion is superadmin-only. Subadmins can create/edit/assign but never delete.
    if (!requireSuperAdmin(req, res)) return;
    const count = await deleteTask(slug, v, taskId);
    await logAudit(req, 'delete_task', 'task', { slug, version: v, taskId, deletedCount: count });
    return res.status(200).json({ deleted: count });
  }
  if (req.method === 'PATCH') {
    if (!requirePermission('task:update')(req, res)) return;
    const { direction, action, targetId, position, status, orderedIds, positions } = req.body || {};
    if (action === 'boardReorder') {
      const tasks = await reorderBoard(slug, v, status, Array.isArray(orderedIds) ? orderedIds : []);
      await logAudit(req, 'board_reorder', 'task', { slug, version: v, status, count: (orderedIds || []).length });
      return res.status(200).json(tasks);
    }
    if (action === 'restorePositions') {
      const tasks = await restorePositions(slug, v, Array.isArray(positions) ? positions : []);
      await logAudit(req, 'restore_positions', 'task', { slug, version: v, count: (positions || []).length });
      return res.status(200).json(tasks);
    }
    if (action === 'move') {
      const tasks = await moveTask(slug, v, taskId, targetId, position);
      if (!tasks) return res.status(404).json({ error: 'Not found' });
      await logAudit(req, 'move_task', 'task', { slug, version: v, taskId, targetId, position });
      return res.status(200).json(tasks);
    }
    const tasks = await reorderTask(slug, v, taskId, direction);
    if (!tasks) return res.status(404).json({ error: 'Not found' });
    await logAudit(req, 'reorder_task', 'task', { slug, version: v, taskId, direction });
    return res.status(200).json(tasks);
  }
  res.status(405).json({ error: 'Method not allowed' });
}
