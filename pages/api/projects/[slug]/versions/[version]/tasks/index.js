const { listTasks, createTask, REPLAYED } = require('../../../../../../../lib/task-store');
const { logAudit, getAuditUser } = require('../../../../../../../lib/audit-log');
const { recordTaskCreate } = require('../../../../../../../lib/task-history-store');
const { requirePermission, requireProjectAccess } = require('../../../../../../../lib/require-permission');
const { stripTasksMedia, stripTaskMedia, validateAttachments, AttachmentError } = require('../../../../../../../lib/task-media');
const { sendJsonCached } = require('../../../../../../../lib/etag');
const { requireLabels } = require('../../../../../../../lib/require-label');
const { withCpuLog } = require('../../../../../../../lib/cpu-log');

async function handler(req, res) {
  const { slug, version } = req.query;
  if (!await requireProjectAccess(slug, req, res)) return;

  if (req.method === 'GET') {
    if (!await requirePermission('task:view', slug)(req, res)) return;
    // Attachment bytes are served by /api/projects/{slug}/media/... — see lib/task-media.js.
    // ETag'd for the same reason as the root list — see lib/etag.js.
    return sendJsonCached(req, res, stripTasksMedia(await listTasks(slug, version), slug, version));
  }
  if (req.method === 'POST') {
    if (!await requirePermission('task:create', slug)(req, res)) return;
    const { id, title, description, status, priority, assignee, assignees, startDate, dueDate, parentId, numberOverride, attachments, cover, labelIds, category } = req.body || {};
    if (!title) return res.status(400).json({ error: 'title is required' });
    if (!await requireLabels(slug, labelIds, res)) return;
    // Prefer a name the creator typed in the form; fall back to the logged-in user.
    let assignedBy = (req.body && typeof req.body.assignedBy === 'string' && req.body.assignedBy.trim()) || null;
    if (!assignedBy) assignedBy = getAuditUser(req)?.name || null;
    let task;
    try {
      validateAttachments(attachments);
      task = await createTask(slug, version, { id, title, description, status, priority, assignee, assignees, assignedBy, startDate, dueDate, parentId, numberOverride, attachments, cover, labelIds, category });
    } catch (e) {
      if (e instanceof AttachmentError) return res.status(413).json({ error: e.message });
      if (e && e.code === 'TASK_LIST_SIZE') return res.status(507).json({ error: e.message });
      if (e && e.code === 'TASK_LOCK') return res.status(503).json({ error: e.message });
      throw e;
    }
    // A replay of a create we already committed — the audit and history entries exist.
    if (!task[REPLAYED]) {
      await logAudit(req, 'create_task', 'task', { slug, version, taskId: task.id, title, parentId });
      await recordTaskCreate(slug, version, task.id, getAuditUser(req), task);
    }
    return res.status(201).json(stripTaskMedia(task, slug, version));
  }
  res.status(405).json({ error: 'Method not allowed' });
}

export default withCpuLog(handler, '/api/projects/[slug]/versions/[version]/tasks');
