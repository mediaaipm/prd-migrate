const { getProject, updateProject, deleteProject } = require('../../../lib/prd-store');
const { logAudit } = require('../../../lib/audit-log');
const { requirePermission, requireProjectAccess, hasPermission } = require('../../../lib/require-permission');
const { requireSuperAdmin } = require('../../../lib/require-superadmin');

export default async function handler(req, res) {
  const { slug } = req.query;
  if (!await requireProjectAccess(slug, req, res)) return;
  if (req.method === 'GET') {
    const project = await getProject(slug);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    await logAudit(req, 'view_project', 'project', { slug });
    // The project record embeds its versions and proposals, so the visibility
    // permissions have to be applied here too — not just on the list routes.
    const [canVersions, canProposals] = await Promise.all([
      hasPermission(req, 'version:view', slug),
      hasPermission(req, 'proposal:view', slug),
    ]);
    return res.status(200).json({
      ...project,
      versions: canVersions ? (project.versions || []) : [],
      proposals: canProposals ? (project.proposals || []) : [],
    });
  }
  if (req.method === 'PUT') {
    if (!await requirePermission('project:update', slug)(req, res)) return;
    const { name, description, status, priority, members, taskAcl, taskPrefix, taskSeqStart } = req.body || {};
    const project = await updateProject(slug, { name, description, status, priority, members, taskAcl, taskPrefix, taskSeqStart });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    await logAudit(req, 'update_project', 'project', { slug, name });
    return res.status(200).json(project);
  }
  if (req.method === 'DELETE') {
    if (!requireSuperAdmin(req, res)) return;
    const ok = await deleteProject(slug);
    if (!ok) return res.status(404).json({ error: 'Project not found' });
    await logAudit(req, 'delete_project', 'project', { slug });
    return res.status(200).json({ deleted: true });
  }
  res.status(405).json({ error: 'Method not allowed' });
}
