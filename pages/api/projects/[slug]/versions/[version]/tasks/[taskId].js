const { getTask, updateTask, deleteTask, reorderTask, moveTask, restorePositions, reorderBoard, listTasks } = require('../../../../../../../lib/task-store');
const { logAudit, getAuditUser } = require('../../../../../../../lib/audit-log');
const { recordTaskUpdate } = require('../../../../../../../lib/task-history-store');
const { notifyTaskChange } = require('../../../../../../../lib/notification-store');
const { requireAdmin } = require('../../../../../../../lib/require-admin');
const { requireSuperAdmin } = require('../../../../../../../lib/require-superadmin');
const { requireProjectAccess, hasPermission, isAssignee, assigneeStatusAllowed, isPrivileged } = require('../../../../../../../lib/require-permission');
const { getProject } = require('../../../../../../../lib/prd-store');
const { getEffectiveRolePolicy, isStatusRestricted } = require('../../../../../../../lib/role-policy');
const { stripTaskMedia, stripTasksMedia, mergeTaskMedia, validateAttachments, AttachmentError } = require('../../../../../../../lib/task-media');
const { sanitizeChecklist, stampChecklist } = require('../../../../../../../lib/task-checklist');
const { sanitizeAcceptance, stampAcceptance, acceptanceStructureIntact } = require('../../../../../../../lib/task-acceptance');
const { allowReparent, moveParentId, isNestingCapped } = require('../../../../../../../lib/task-nesting');

// Same shared surfaces as the root task route: a board opened on a version tab
// writes here instead, and a tick box that works on one board and 403s on the
// other is the same bug twice. `updates` is deliberately absent — this route has
// no comment-integrity guard, so the thread stays task:update only.
const SHARED_FIELDS = new Set(['checklist', 'acceptance']);

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
  const { slug, version, taskId } = req.query;
  if (!await requireProjectAccess(slug, req, res)) return;

  if (req.method === 'GET') {
    const task = await getTask(slug, version, taskId);
    if (!task) return res.status(404).json({ error: 'Not found' });
    return res.status(200).json(stripTaskMedia(task, slug, version));
  }
  if (req.method === 'PUT') {
    let updates = req.body || {};
    const before = await getTask(slug, version, taskId);
    if (!before) return res.status(404).json({ error: 'Not found' });
    // Regular users may change ONLY the status of tasks they're on (subject to the
    // project ACL). Full edits require task:update — held by subadmins/superadmin.
    const statusOnly = Object.keys(updates).length > 0 && Object.keys(updates).every(k => k === 'status');
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
    if ('checklist' in updates) {
      updates.checklist = stampChecklist(sanitizeChecklist(updates.checklist), before.checklist, actor);
    }
    // Authoring criteria is a task edit; ticking one is a verification anyone who
    // can open the card may do — but only when the wording and order are
    // untouched. See lib/task-acceptance.js.
    if ('acceptance' in updates) {
      const nextAcceptance = sanitizeAcceptance(updates.acceptance);
      if (!canEditTask && !acceptanceStructureIntact(nextAcceptance, before.acceptance)) {
        return res.status(403).json({ error: 'Only a task editor can add, reword or remove acceptance criteria.' });
      }
      updates.acceptance = stampAcceptance(nextAcceptance, before.acceptance, actor);
    }
    // Per-project, superadmin-defined blocklist: regular users cannot move a task
    // into these statuses. Admins/superadmin are exempt.
    if ('status' in updates && !isPrivileged(req)) {
      const { userRestrictedStatuses } = await getEffectiveRolePolicy(slug);
      if (isStatusRestricted(userRestrictedStatuses, updates.status)) {
        return res.status(403).json({ error: `Only an admin can move a task to "${updates.status}".` });
      }
    }
    // Re-parenting arrives here as an ordinary field (the swimlane board writes it
    // when a card changes story). Admins may not use it to lift a task back up to
    // main-task or sub-task level — see lib/task-nesting.js.
    if ('parentId' in updates && !await allowReparent(req, res, slug, version, [{ id: taskId, parentId: updates.parentId }])) return;
    // Changing a task's display id is an admin-level action.
    if ('seq' in updates && !requireAdmin(req, res)) return;
    // Flag/unflag the task for repeated delay reminders (see /api/cron/delayed-reminders).
    if ('dueDate' in updates) {
      updates.dueDelayed = !!(before.dueDate && updates.dueDate && new Date(updates.dueDate) > new Date(before.dueDate));
    }
    if (updates.status === 'done') updates.dueDelayed = false;
    // `points` rides through as a plain field: task-store normalises it (null when
    // blank/NaN/negative) and derives `completedAt` from the status transition, so
    // neither can be dictated by the request body.
    // Restore the attachment bytes the client could not send back — see lib/task-media.js.
    let task;
    try {
      validateAttachments(updates.attachments);
      updates = mergeTaskMedia(updates, before);
      task = await updateTask(slug, version, taskId, updates);
    } catch (e) {
      if (e instanceof AttachmentError) return res.status(413).json({ error: e.message });
      if (e && e.code === 'TASK_ID') return res.status(409).json({ error: e.message });
      throw e;
    }
    await logAudit(req, 'update_task', 'task', { slug, version, taskId, fields: Object.keys(updates) });
    await recordTaskUpdate(slug, version, taskId, getAuditUser(req), before, updates);
    await notifyTaskChange(getAuditUser(req)?.name, { slug, version, before, updates });
    return res.status(200).json(stripTaskMedia(task, slug, version));
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
      return res.status(200).json(stripTasksMedia(tasks, slug, version));
    }
    if (action === 'restorePositions') {
      // Whole-tree snapshot: only the entries that actually change a parent are gated.
      if (!await allowReparent(req, res, slug, version, Array.isArray(positions) ? positions : [])) return;
      const tasks = await restorePositions(slug, version, Array.isArray(positions) ? positions : []);
      await logAudit(req, 'restore_positions', 'task', { slug, version, count: (positions || []).length });
      return res.status(200).json(stripTasksMedia(tasks, slug, version));
    }
    if (action === 'move') {
      // A drag names a target and a position, not a parent. Resolve the parent the
      // move will produce before deciding whether an admin may make it.
      if (isNestingCapped(req)) {
        const parentId = moveParentId(await listTasks(slug, version), targetId, position);
        if (parentId !== undefined && !await allowReparent(req, res, slug, version, [{ id: taskId, parentId }])) return;
      }
      const tasks = await moveTask(slug, version, taskId, targetId, position);
      if (!tasks) return res.status(404).json({ error: 'Not found' });
      await logAudit(req, 'move_task', 'task', { slug, version, taskId, targetId, position });
      return res.status(200).json(stripTasksMedia(tasks, slug, version));
    }
    const tasks = await reorderTask(slug, version, taskId, direction);
    if (!tasks) return res.status(404).json({ error: 'Not found' });
    await logAudit(req, 'reorder_task', 'task', { slug, version, taskId, direction });
    return res.status(200).json(stripTasksMedia(tasks, slug, version));
  }
  res.status(405).json({ error: 'Method not allowed' });
}
