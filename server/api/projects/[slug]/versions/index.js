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
    // Creating a version is what promoting a proposal used to do, so it needs the same
    // permission. Only a real bump is accepted: 'same' would overwrite the latest
    // version's text in place.
    if (!await requirePermission('proposal:promote', slug)(req, res)) return;
    const { bumpType, content } = req.body || {};
    const bump = bumpType || 'patch';
    if (!['major', 'minor', 'patch'].includes(bump)) return res.status(400).json({ error: 'bumpType must be major, minor or patch.' });
    if (content !== undefined && typeof content !== 'string') return res.status(400).json({ error: 'content must be text.' });
    const version = await createVersion(slug, bump, content || '');
    await logAudit(req, 'create_version', 'version', { slug, version: version.version, bumpType });
    return res.status(201).json(version);
  }
  res.status(405).json({ error: 'Method not allowed' });
}
