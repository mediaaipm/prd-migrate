const { getVersion, getProposal } = require('../../../../lib/prd-store');
const { logAudit } = require('../../../../lib/audit-log');
const { requireProjectAccess } = require('../../../../lib/require-permission');

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { slug, left, leftType = 'version', right } = req.query;
  if (!await requireProjectAccess(slug, req, res)) return;

  if (!slug || !left || !right) {
    return res.status(400).json({ error: 'slug, left, and right are required' });
  }

  let leftData;
  if (leftType === 'proposal') {
    const p = await getProposal(slug, left);
    if (!p) return res.status(404).json({ error: `Proposal "${left}" not found` });
    leftData = { content: p.content || '', label: `Proposal: ${p.title}`, date: p.updatedAt || p.createdAt };
  } else {
    const ver = await getVersion(slug, left);
    if (!ver) return res.status(404).json({ error: `Version "${left}" not found` });
    leftData = { content: ver.content || '', label: `v${ver.version}`, date: ver.updatedAt || ver.createdAt };
  }

  const rightVer = await getVersion(slug, right);
  if (!rightVer) return res.status(404).json({ error: `Version "${right}" not found` });
  const rightData = { content: rightVer.content || '', label: `v${rightVer.version}`, date: rightVer.updatedAt || rightVer.createdAt };

  await logAudit(req, 'view_diff', 'version', { slug, left, leftType, right });
  res.status(200).json({ left: leftData, right: rightData });
}
