const { promoteProposal } = require('../../../../../../lib/prd-store');
const { logAudit } = require('../../../../../../lib/audit-log');
const { requirePermission, requireProjectAccess } = require('../../../../../../lib/require-permission');

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { slug, id } = req.query;
  if (!await requireProjectAccess(slug, req, res)) return;
  if (!await requirePermission('proposal:promote', slug)(req, res)) return;
  const { bumpType } = req.body || {};
  const version = await promoteProposal(slug, id, bumpType || 'minor');
  if (!version) return res.status(404).json({ error: 'Proposal not found' });
  await logAudit(req, 'promote_proposal', 'proposal', { slug, proposalId: id, newVersion: version.version, bumpType });
  return res.status(200).json(version);
}
