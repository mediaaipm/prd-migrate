const { Redis } = require('@upstash/redis');
let _kv;
function getKv() { if (!_kv) _kv = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN }); return _kv; }
const { listProjects, createProject } = require('../../../lib/prd-store');
const { logAudit } = require('../../../lib/audit-log');
const { requirePermission } = require('../../../lib/require-permission');

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const all = await listProjects();
    try {
      const user = JSON.parse(req.headers['x-user'] || '{}')
      if (user.role === 'admin') {
        const profile = await getKv().hgetall('user:' + user.name) || {}
        let assigned = profile.assignedProjects
        if (assigned) {
          if (typeof assigned === 'string') { try { assigned = JSON.parse(assigned) } catch { assigned = null } }
          if (Array.isArray(assigned)) {
            return res.status(200).json(all.filter(p => assigned.includes(p.slug)))
          }
        }
      }
    } catch {}
    return res.status(200).json(all);
  }
  if (req.method === 'POST') {
    if (!requirePermission('project:create')(req, res)) return;
    const { name, description } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    const project = await createProject(name, description);
    await logAudit(req, 'create_project', 'project', { slug: project.slug, name });
    return res.status(201).json(project);
  }
  res.status(405).json({ error: 'Method not allowed' });
}
