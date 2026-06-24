const { listTasks, createTask } = require('../../../../../lib/task-store');
const { logAudit } = require('../../../../../lib/audit-log');
const { requirePermission, requireProjectAccess } = require('../../../../../lib/require-permission');

export default async function handler(req, res) {
  const { slug, version } = req.query;
  if (!await requireProjectAccess(slug, req, res)) return;
  const v = version || null;

  if (req.method === 'GET') {
    return res.status(200).json(await listTasks(slug, v));
  }
  if (req.method === 'POST') {
    if (!requirePermission('task:create')(req, res)) return;
    const { title, description, status, priority, assignee, assignees, startDate, dueDate, parentId, numberOverride } = req.body || {};
    if (!title) return res.status(400).json({ error: 'title is required' });
    let assignedBy = null;
    try { assignedBy = (JSON.parse(req.headers['x-user'] || '{}').name) || null; } catch {}
    const task = await createTask(slug, v, { title, description, status, priority, assignee, assignees, assignedBy, startDate, dueDate, parentId, numberOverride });
    await logAudit(req, 'create_task', 'task', { slug, version: v, taskId: task.id, title, parentId });
    return res.status(201).json(task);
  }
  res.status(405).json({ error: 'Method not allowed' });
}
