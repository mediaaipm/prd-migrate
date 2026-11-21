const { getTaskHistory } = require('../../../../../../lib/task-history-store');
const { getTask } = require('../../../../../../lib/task-store');
const { requireProjectAccess } = require('../../../../../../lib/require-permission');

// Tasks created before the activity log existed have no recorded history.
// Fall back to the task's own createdAt/updatedAt timestamps so the modal can
// still show at least when it was created and last edited.
function fallbackHistory(task) {
  if (!task) return [];
  const entries = [];
  if (task.updatedAt && task.updatedAt !== task.createdAt) {
    entries.push({
      id: 'fallback-updated',
      timestamp: task.updatedAt,
      action: 'updated',
      actor: null,
      synthetic: true,
    });
  }
  if (task.createdAt) {
    entries.push({
      id: 'fallback-created',
      timestamp: task.createdAt,
      action: 'created',
      actor: null,
      synthetic: true,
    });
  }
  return entries; // newest first
}

export default async function handler(req, res) {
  const { slug, taskId, version } = req.query;
  // Activity log is viewable by anyone with access to the project.
  if (!await requireProjectAccess(slug, req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const history = await getTaskHistory(slug, version || null, taskId);
  if (history && history.length > 0) return res.status(200).json(history);
  const task = await getTask(slug, version || null, taskId);
  return res.status(200).json(fallbackHistory(task));
}
