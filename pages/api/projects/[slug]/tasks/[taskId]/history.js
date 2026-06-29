const { getTaskHistory } = require('../../../../../../lib/task-history-store');
const { requireAdmin } = require('../../../../../../lib/require-admin');
const { requireProjectAccess } = require('../../../../../../lib/require-permission');

export default async function handler(req, res) {
  const { slug, taskId, version } = req.query;
  if (!await requireProjectAccess(slug, req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  // Activity log is admin-only.
  if (!requireAdmin(req, res)) return;
  const history = await getTaskHistory(slug, version || null, taskId);
  return res.status(200).json(history);
}
