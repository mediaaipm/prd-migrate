const { listTasks, createTask, REPLAYED } = require('../../../../../lib/task-store');
const { logAudit, getAuditUser } = require('../../../../../lib/audit-log');
const { recordTaskCreate } = require('../../../../../lib/task-history-store');
const { requirePermission, requireProjectAccess } = require('../../../../../lib/require-permission');
const { stripTasksMedia, stripTaskMedia, validateAttachments, AttachmentError } = require('../../../../../lib/task-media');

export default async function handler(req, res) {
  const { slug, version } = req.query;
  if (!await requireProjectAccess(slug, req, res)) return;
  const v = version || null;

  if (req.method === 'GET') {
    if (!await requirePermission('task:view', slug)(req, res)) return;
    // Attachment bytes are served by /api/projects/{slug}/media/... — shipping them
    // inline here re-sent every image on every board load.
    return res.status(200).json(stripTasksMedia(await listTasks(slug, v), slug, v));
  }
  if (req.method === 'POST') {
    if (!await requirePermission('task:create', slug)(req, res)) return;
    const { id, title, description, status, priority, assignee, assignees, startDate, dueDate, parentId, numberOverride, attachments, cover, labelIds } = req.body || {};
    if (!title) return res.status(400).json({ error: 'title is required' });
    // Prefer a name the creator typed in the form; fall back to the logged-in user.
    let assignedBy = (req.body && typeof req.body.assignedBy === 'string' && req.body.assignedBy.trim()) || null;
    if (!assignedBy) assignedBy = getAuditUser(req)?.name || null;
    let task;
    try {
      validateAttachments(attachments);
      task = await createTask(slug, v, { id, title, description, status, priority, assignee, assignees, assignedBy, startDate, dueDate, parentId, numberOverride, attachments, cover, labelIds });
    } catch (e) {
      if (e instanceof AttachmentError) return res.status(413).json({ error: e.message });
      // The stored list would exceed what redis accepts in one write. Report it as
      // the storage problem it is instead of an unexplained 500.
      if (e && e.code === 'TASK_LIST_SIZE') return res.status(507).json({ error: e.message });
      // Someone else is mid-write on this list. 503 keeps the item in the client's
      // write queue, which replays it — never a silent loss.
      if (e && e.code === 'TASK_LOCK') return res.status(503).json({ error: e.message });
      throw e;
    }
    // A replay of a create we already committed — the audit and history entries exist.
    if (!task[REPLAYED]) {
      await Promise.all([
        logAudit(req, 'create_task', 'task', { slug, version: v, taskId: task.id, title, parentId }),
        recordTaskCreate(slug, v, task.id, getAuditUser(req), task),
      ]);
    }
    return res.status(201).json(stripTaskMedia(task, slug, v));
  }
  res.status(405).json({ error: 'Method not allowed' });
}
