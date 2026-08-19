const { getTask, updateTask, deleteTask, reorderTask, moveTask, restorePositions, reorderBoard } = require('../../../../../lib/task-store');
const { logAudit, getAuditUser } = require('../../../../../lib/audit-log');
const { recordTaskUpdate } = require('../../../../../lib/task-history-store');
const { notifyTaskChange } = require('../../../../../lib/notification-store');
const { requirePermission, requireProjectAccess, hasPermission, isAssignee, assigneeStatusAllowed, isPrivileged } = require('../../../../../lib/require-permission');
const { requireSuperAdmin } = require('../../../../../lib/require-superadmin');
const { getProject } = require('../../../../../lib/prd-store');
const { getEffectiveRolePolicy, isStatusRestricted } = require('../../../../../lib/role-policy');
const { stripTaskMedia, stripTasksMedia, mergeTaskMedia, validateAttachments, AttachmentError } = require('../../../../../lib/task-media');
const { sanitizeChecklist, stampChecklist } = require('../../../../../lib/task-checklist');

// Fields a viewer may write on a task they can open, without task:update.
const SHARED_FIELDS = new Set(['checklist', 'updates']);

export default async function handler(req, res) {
  try {
    return await route(req, res);
  } catch (e) {
    // Contended task-list lock. 503 is transient for the client write queue, so the
    // mutation is replayed instead of being dropped.
    if (e && e.code === 'TASK_LOCK') return res.status(503).json({ error: e.message });
    // The stored list would exceed what redis accepts in one write.
    if (e && e.code === 'TASK_LIST_SIZE') return res.status(507).json({ error: e.message });
    throw e;
  }
}

async function route(req, res) {
  const { slug, taskId, version } = req.query;
  if (!await requireProjectAccess(slug, req, res)) return;
  const v = version || null;

  if (req.method === 'GET') {
    const task = await getTask(slug, v, taskId);
    if (!task) return res.status(404).json({ error: 'Not found' });
    return res.status(200).json(stripTaskMedia(task, slug, v));
  }
  if (req.method === 'PUT') {
    let updates = req.body || {};
    const before = await getTask(slug, v, taskId);
    if (!before) return res.status(404).json({ error: 'Not found' });
    // Regular users may change ONLY the status of tasks they're on (subject to the
    // project ACL). Full edits require task:update — held by subadmins/superadmin.
    const statusOnly = Object.keys(updates).length > 0 && Object.keys(updates).every(k => k === 'status');
    // Shared surfaces: the checklist and the comment thread belong to everyone who
    // can open the card, not just to whoever may edit the task. A patch touching
    // only these needs project access, which requireProjectAccess already proved.
    const sharedOnly = Object.keys(updates).length > 0
      && Object.keys(updates).every(k => SHARED_FIELDS.has(k));
    const canEditTask = await hasPermission(req, 'task:update', slug);
    let allowed = canEditTask;
    if (!allowed && statusOnly && isAssignee(req, before)) {
      const project = await getProject(slug);
      allowed = assigneeStatusAllowed(project?.taskAcl, updates.status);
    }
    if (!allowed && sharedOnly) allowed = true;
    if (!allowed) return res.status(403).json({ error: 'Permission denied: task:update' });
    const actor = getAuditUser(req)?.name || null;
    // Anyone may add to the thread; only task editors may rewrite or drop what is
    // already there. Without this a shared-surface patch could silently truncate
    // the comment history it was allowed to append to.
    if ('updates' in updates) {
      const prevComments = Array.isArray(before.updates) ? before.updates : [];
      const nextComments = Array.isArray(updates.updates) ? updates.updates : [];
      const kept = nextComments.slice(0, prevComments.length);
      const intact = prevComments.length <= nextComments.length
        && prevComments.every((u, i) => u?.id === kept[i]?.id);
      if (!canEditTask && !intact) {
        return res.status(403).json({ error: 'Existing comments cannot be edited or removed.' });
      }
      // Authorship comes from the session, never from the body.
      updates.updates = nextComments.map((u, i) => (
        i < prevComments.length && u?.id === prevComments[i]?.id ? u : { ...u, author: actor }
      ));
    }
    if ('checklist' in updates) {
      updates.checklist = stampChecklist(sanitizeChecklist(updates.checklist), before.checklist, actor);
    }
    // Per-project, superadmin-defined blocklist: regular users cannot move a task
    // into these statuses. Admins/superadmin are exempt.
    if ('status' in updates && !isPrivileged(req)) {
      const { userRestrictedStatuses } = await getEffectiveRolePolicy(slug);
      if (isStatusRestricted(userRestrictedStatuses, updates.status)) {
        return res.status(403).json({ error: `Only an admin can move a task to "${updates.status}".` });
      }
    }
    // Changing a task's display id is an admin-level action.
    if ('seq' in updates && !(await hasPermission(req, 'task:update', slug))) {
      return res.status(403).json({ error: 'Permission denied: task:update' });
    }
    // Flag/unflag the task for repeated delay reminders (see /api/cron/delayed-reminders).
    if ('dueDate' in updates) {
      updates.dueDelayed = !!(before.dueDate && updates.dueDate && new Date(updates.dueDate) > new Date(before.dueDate));
    }
    if (updates.status === 'done') updates.dueDelayed = false;
    // The client edited a task it read from a stripped list response, so any
    // attachment it did not re-upload arrives without its bytes. Put them back
    // from `before` or the save would wipe the image.
    let task;
    try {
      validateAttachments(updates.attachments);
      updates = mergeTaskMedia(updates, before);
      task = await updateTask(slug, v, taskId, updates);
    } catch (e) {
      if (e instanceof AttachmentError) return res.status(413).json({ error: e.message });
      if (e && e.code === 'TASK_ID') return res.status(409).json({ error: e.message });
      throw e;
    }
    const details = { slug, version: v, taskId, fields: Object.keys(updates) };
    if ('status' in updates) { details.statusFrom = before.status; details.statusTo = updates.status; }
    await logAudit(req, 'update_task', 'task', details);
    await recordTaskUpdate(slug, v, taskId, getAuditUser(req), before, updates);
    await notifyTaskChange(getAuditUser(req)?.name, { slug, version: v, before, updates });
    return res.status(200).json(stripTaskMedia(task, slug, v));
  }
  if (req.method === 'DELETE') {
    // Deletion is superadmin-only. Subadmins can create/edit/assign but never delete.
    if (!requireSuperAdmin(req, res)) return;
    const count = await deleteTask(slug, v, taskId);
    await logAudit(req, 'delete_task', 'task', { slug, version: v, taskId, deletedCount: count });
    return res.status(200).json({ deleted: count });
  }
  if (req.method === 'PATCH') {
    if (!await requirePermission('task:update', slug)(req, res)) return;
    const { direction, action, targetId, position, status, orderedIds, positions } = req.body || {};
    if (action === 'boardReorder') {
      const tasks = await reorderBoard(slug, v, status, Array.isArray(orderedIds) ? orderedIds : []);
      await logAudit(req, 'board_reorder', 'task', { slug, version: v, status, count: (orderedIds || []).length });
      return res.status(200).json(stripTasksMedia(tasks, slug, v));
    }
    if (action === 'restorePositions') {
      const tasks = await restorePositions(slug, v, Array.isArray(positions) ? positions : []);
      await logAudit(req, 'restore_positions', 'task', { slug, version: v, count: (positions || []).length });
      return res.status(200).json(stripTasksMedia(tasks, slug, v));
    }
    if (action === 'move') {
      const tasks = await moveTask(slug, v, taskId, targetId, position);
      if (!tasks) return res.status(404).json({ error: 'Not found' });
      await logAudit(req, 'move_task', 'task', { slug, version: v, taskId, targetId, position });
      return res.status(200).json(stripTasksMedia(tasks, slug, v));
    }
    const tasks = await reorderTask(slug, v, taskId, direction);
    if (!tasks) return res.status(404).json({ error: 'Not found' });
    await logAudit(req, 'reorder_task', 'task', { slug, version: v, taskId, direction });
    return res.status(200).json(stripTasksMedia(tasks, slug, v));
  }
  res.status(405).json({ error: 'Method not allowed' });
}
