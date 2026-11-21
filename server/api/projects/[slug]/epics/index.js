const { listEpics, createEpic } = require('../../../../../lib/epic-store');
const { logAudit, getAuditUser } = require('../../../../../lib/audit-log');
const { requirePermission, requireProjectAccess, hasPermission } = require('../../../../../lib/require-permission');

// Mirrors requireSuperAdmin — the epic DELETE gate.
function isSuper(user) {
  return user.role === 'superadmin' || (user.isAdmin === true && !user.role);
}

// Epics group stories (root tasks) across every version of a project. Anyone who can
// see tasks can see epics; shaping them is a project-level edit (`project:update`).
// Linking a story to an epic is an ordinary task edit and goes through the task PUT.
export default async function handler(req, res) {
  const { slug } = req.query;
  if (!await requireProjectAccess(slug, req, res)) return;

  if (req.method === 'GET') {
    if (!await requirePermission('task:view', slug)(req, res)) return;
    const [epics, canManage, canLink] = await Promise.all([
      listEpics(slug),
      hasPermission(req, 'project:update', slug),
      hasPermission(req, 'task:update', slug),
    ]);
    // The client hides controls the API would refuse; these mirror the gates below
    // and in the task PUT, so the page never has to re-derive the policy.
    return res.status(200).json({ epics, canManage, canLink, canDelete: isSuper(getAuditUser(req) || {}) });
  }
  if (req.method === 'POST') {
    if (!await requirePermission('project:update', slug)(req, res)) return;
    try {
      const epic = await createEpic(slug, req.body, getAuditUser(req)?.name || null);
      await logAudit(req, 'create_epic', 'epic', { slug, epicId: epic.id, name: epic.name });
      return res.status(201).json({ ...epic, progress: { stories: 0, storiesDone: 0, subtasks: 0, subtasksDone: 0, points: 0, pointsDone: 0 } });
    } catch (e) {
      if (e && e.code === 'EPIC') return res.status(e.status).json({ error: e.message });
      throw e;
    }
  }
  res.status(405).json({ error: 'Method not allowed' });
}
