const { listTasks, createTask } = require('../../../../../../../lib/task-store');
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
    if (!requirePermission('task:create')(req, res)) return;
    const { title, description, status, priority, assignee, assignees, startDate, dueDate, parentId, numberOverride } = req.body || {};
    if (!title) return res.status(400).json({ error: 'title is required' });
    // Prefer a name the creator typed in the form; fall back to the logged-in user.
    let assignedBy = (req.body && typeof req.body.assignedBy === 'string' && req.body.assignedBy.trim()) || null;
    if (!assignedBy) { try { assignedBy = (JSON.parse(req.headers['x-user'] || '{}').name) || null; } catch {} }
    const task = await createTask(slug, version, { title, description, status, priority, assignee, assignees, assignedBy, startDate, dueDate, parentId, numberOverride });
    await logAudit(req, 'create_task', 'task', { slug, version, taskId: task.id, title, parentId });
    await recordTaskCreate(slug, version, task.id, getAuditUser(req), task);
    return res.status(201).json(task);
  }
  res.status(405).json({ error: 'Method not allowed' });
}
