const { listProjects, createProject } = require('../../../lib/prd-store');
const { logAudit } = require('../../../lib/audit-log');
const { requirePermission, hasPermission, visibleProjects } = require('../../../lib/require-permission');
const { getSessionUser } = require('../../../lib/session');

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const user = getSessionUser(req)
    if (!user) return res.status(401).json({ error: 'Not signed in.' })
    // Visibility is two-layered: the `project:view` permission decides whether the
    // account sees projects at all, the personal/group assignment decides which.
    if (!await hasPermission(req, 'project:view')) return res.status(200).json([]);
    const all = await listProjects();
    return res.status(200).json(await visibleProjects(req, all));
  }
  if (req.method === 'POST') {
    if (!await requirePermission('project:create')(req, res)) return;
    const { name, description, status, priority, members, taskPrefix, taskSeqStart } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    const project = await createProject(name, description, { status, priority, members, taskPrefix, taskSeqStart });
    await logAudit(req, 'create_project', 'project', { slug: project.slug, name });
    return res.status(201).json(project);
  }
  res.status(405).json({ error: 'Method not allowed' });
}
