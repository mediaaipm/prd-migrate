const { getEpicWithStories, updateEpic, deleteEpic } = require('../../../../../lib/epic-store');
const { logAudit } = require('../../../../../lib/audit-log');
const { requirePermission, requireProjectAccess } = require('../../../../../lib/require-permission');
const { requireSuperAdmin } = require('../../../../../lib/require-superadmin');

export default async function handler(req, res) {
  const { slug, id } = req.query;
  if (!await requireProjectAccess(slug, req, res)) return;

  try {
    if (req.method === 'GET') {
      if (!await requirePermission('task:view', slug)(req, res)) return;
      const found = await getEpicWithStories(slug, id);
      if (!found) return res.status(404).json({ error: 'Epic not found' });
      return res.status(200).json(found);
    }
    if (req.method === 'PUT') {
      if (!await requirePermission('project:update', slug)(req, res)) return;
      const epic = await updateEpic(slug, id, req.body);
      if (!epic) return res.status(404).json({ error: 'Epic not found' });
      await logAudit(req, 'update_epic', 'epic', { slug, epicId: id, fields: Object.keys(req.body || {}) });
      return res.status(200).json(epic);
    }
    if (req.method === 'DELETE') {
      // Deletion is superadmin-only, same as tasks. The stories are unlinked, not deleted.
      if (!requireSuperAdmin(req, res)) return;
      const result = await deleteEpic(slug, id);
      if (!result) return res.status(404).json({ error: 'Epic not found' });
      await logAudit(req, 'delete_epic', 'epic', { slug, epicId: id, unlinked: result.unlinked });
      return res.status(200).json(result);
    }
  } catch (e) {
    if (e && e.code === 'EPIC') return res.status(e.status).json({ error: e.message });
    if (e && e.code === 'TASK_LOCK') return res.status(503).json({ error: e.message });
    throw e;
  }
  res.status(405).json({ error: 'Method not allowed' });
}
