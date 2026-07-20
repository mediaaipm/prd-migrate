const { listTasks, createTask, REPLAYED } = require('../../../../../../../lib/task-store');
const { logAudit, getAuditUser } = require('../../../../../../../lib/audit-log');
const { recordTaskCreate } = require('../../../../../../../lib/task-history-store');
const { requirePermission, requireProjectAccess } = require('../../../../../../../lib/require-permission');

export default async function handler(req, res) {
  const { slug, version } = req.query;
  if (!await requireProjectAccess(slug, req, res)) return;

  if (req.method === 'GET') {
    return res.status(200).json(await listTasks(slug, version));
  }
  if (req.method === 'POST') {
    if (!await requirePermission('task:create', slug)(req, res)) return;
    const { id, title, description, status, priority, assignee, assignees, startDate, dueDate, parentId, numberOverride, attachments, cover, labelIds } = req.body || {};
    if (!title) return res.status(400).json({ error: 'title is required' });
    // Prefer a name the creator typed in the form; fall back to the logged-in user.
    let assignedBy = (req.body && typeof req.body.assignedBy === 'string' && req.body.assignedBy.trim()) || null;
    if (!assignedBy) { try { assignedBy = (JSON.parse(req.headers['x-user'] || '{}').name) || null; } catch {} }
    const task = await createTask(slug, version, { id, title, description, status, priority, assignee, assignees, assignedBy, startDate, dueDate, parentId, numberOverride, attachments, cover, labelIds });
    // A replay of a create we already committed — the audit and history entries exist.
    if (!task[REPLAYED]) {
      await logAudit(req, 'create_task', 'task', { slug, version, taskId: task.id, title, parentId });
      await recordTaskCreate(slug, version, task.id, getAuditUser(req), task);
    }
    return res.status(201).json(task);
  }
  res.status(405).json({ error: 'Method not allowed' });
}
