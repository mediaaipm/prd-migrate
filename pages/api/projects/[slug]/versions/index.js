const { listVersions, createVersion } = require('../../../../../lib/prd-store');
const { logAudit } = require('../../../../../lib/audit-log');
const { requirePermission, requireProjectAccess } = require('../../../../../lib/require-permission');

export default async function handler(req, res) {
  const { slug } = req.query;
  if (!await requireProjectAccess(slug, req, res)) return;
  if (req.method === 'GET') {
    if (!await requirePermission('version:view', slug)(req, res)) return;
    return res.status(200).json(await listVersions(slug));
  }
  if (req.method === 'POST') {
    const { bumpType, content } = req.body || {};
    const version = await createVersion(slug, bumpType || 'patch', content || '');
    await logAudit(req, 'create_version', 'version', { slug, version: version.version, bumpType });
    return res.status(201).json(version);
  }
  res.status(405).json({ error: 'Method not allowed' });
}
