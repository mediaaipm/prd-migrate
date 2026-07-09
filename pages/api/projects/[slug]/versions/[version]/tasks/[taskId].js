const { getTask, updateTask, deleteTask, reorderTask, moveTask, restorePositions, reorderBoard } = require('../../../../../../../lib/task-store');
const { logAudit, getAuditUser } = require('../../../../../../../lib/audit-log');
const { recordTaskUpdate } = require('../../../../../../../lib/task-history-store');
const { notifyTaskChange } = require('../../../../../../../lib/notification-store');
const { requireAdmin } = require('../../../../../../../lib/require-admin');
const { requireSuperAdmin } = require('../../../../../../../lib/require-superadmin');
const { requireProjectAccess, hasPermission, isAssignee, assigneeStatusAllowed } = require('../../../../../../../lib/require-permission');
const { getProject } = require('../../../../../../../lib/prd-store');

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
    const before = await getTask(slug, version, taskId);
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
    if ('seq' in updates && !requireAdmin(req, res)) return;
    // Flag/unflag the task for repeated delay reminders (see /api/cron/delayed-reminders).
    if ('dueDate' in updates) {
      updates.dueDelayed = !!(before.dueDate && updates.dueDate && new Date(updates.dueDate) > new Date(before.dueDate));
    }
    if (updates.status === 'done') updates.dueDelayed = false;
    let task;
    try {
      task = await updateTask(slug, version, taskId, updates);
    } catch (e) {
      if (e && e.code === 'TASK_ID') return res.status(409).json({ error: e.message });
      throw e;
    }
    await logAudit(req, 'update_task', 'task', { slug, version, taskId, fields: Object.keys(updates) });
    await recordTaskUpdate(slug, version, taskId, getAuditUser(req), before, updates);
    await notifyTaskChange(getAuditUser(req)?.name, { slug, version, before, updates });
    return res.status(200).json(task);
  }
  if (req.method === 'DELETE') {
    // Deletion is superadmin-only. Subadmins can create/edit/assign but never delete.
    if (!requireSuperAdmin(req, res)) return;
    const count = await deleteTask(slug, version, taskId);
    await logAudit(req, 'delete_task', 'task', { slug, version, taskId, deletedCount: count });
    return res.status(200).json({ deleted: count });
  }
  if (req.method === 'PATCH') {
    const { direction, action, targetId, position, status, orderedIds, positions } = req.body || {};
    if (action === 'boardReorder') {
      const tasks = await reorderBoard(slug, version, status, Array.isArray(orderedIds) ? orderedIds : []);
      await logAudit(req, 'board_reorder', 'task', { slug, version, status, count: (orderedIds || []).length });
      return res.status(200).json(tasks);
    }
    if (action === 'restorePositions') {
      const tasks = await restorePositions(slug, version, Array.isArray(positions) ? positions : []);
      await logAudit(req, 'restore_positions', 'task', { slug, version, count: (positions || []).length });
      return res.status(200).json(tasks);
    }
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
