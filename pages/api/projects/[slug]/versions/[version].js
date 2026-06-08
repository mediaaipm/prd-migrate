const { getVersion, saveVersion } = require('../../../../../lib/prd-store');
const { logAudit } = require('../../../../../lib/audit-log');
const { requireProjectAccess } = require('../../../../../lib/require-permission');

export default async function handler(req, res) {
  const { slug, version } = req.query;
  if (!await requireProjectAccess(slug, req, res)) return;
  if (req.method === 'GET') {
    const v = await getVersion(slug, version);
    if (!v) return res.status(404).json({ error: 'Version not found' });
    await logAudit(req, 'view_version', 'version', { slug, version });
    return res.status(200).json(v);
  }
  if (req.method === 'PUT') {
    const { content } = req.body || {};
    if (typeof content !== 'string') return res.status(400).json({ error: 'content is required' });
    const ok = await saveVersion(slug, version, content);
    if (!ok) return res.status(404).json({ error: 'Version not found' });
    await logAudit(req, 'save_version', 'version', { slug, version });
    return res.status(200).json({ ok: true });
  }
  res.status(405).json({ error: 'Method not allowed' });
}
