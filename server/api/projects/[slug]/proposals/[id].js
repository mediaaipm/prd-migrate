const { getProposal, updateProposal, deleteProposal } = require('../../../../../lib/prd-store');
const { logAudit } = require('../../../../../lib/audit-log');
const { requirePermission, requireProjectAccess } = require('../../../../../lib/require-permission');

export default async function handler(req, res) {
  const { slug, id } = req.query;
  if (!await requireProjectAccess(slug, req, res)) return;
  if (req.method === 'GET') {
    const p = await getProposal(slug, id);
    if (!p) return res.status(404).json({ error: 'Proposal not found' });
    return res.status(200).json(p);
  }
  if (req.method === 'PUT') {
    if (!await requirePermission('proposal:update', slug)(req, res)) return;
    const updates = req.body || {};
    const p = await updateProposal(slug, id, updates);
    if (!p) return res.status(404).json({ error: 'Proposal not found' });
    await logAudit(req, 'update_proposal', 'proposal', { slug, proposalId: id, fields: Object.keys(updates) });
    return res.status(200).json(p);
  }
  if (req.method === 'DELETE') {
    if (!await requirePermission('proposal:delete', slug)(req, res)) return;
    const ok = await deleteProposal(slug, id);
    if (!ok) return res.status(404).json({ error: 'Proposal not found' });
    await logAudit(req, 'delete_proposal', 'proposal', { slug, proposalId: id });
    return res.status(200).json({ deleted: true });
  }
  res.status(405).json({ error: 'Method not allowed' });
}
