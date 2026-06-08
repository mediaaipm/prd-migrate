const { listProposals, createProposal } = require('../../../../../lib/prd-store');
const { logAudit } = require('../../../../../lib/audit-log');
const { requirePermission, requireProjectAccess } = require('../../../../../lib/require-permission');

export default async function handler(req, res) {
  const { slug } = req.query;
  if (!await requireProjectAccess(slug, req, res)) return;
  if (req.method === 'GET') {
    return res.status(200).json(await listProposals(slug));
  }
  if (req.method === 'POST') {
    if (!requirePermission('proposal:create')(req, res)) return;
    const { title, description, content, assignee, startDate, dueDate } = req.body || {};
    if (!title) return res.status(400).json({ error: 'title is required' });
    const proposal = await createProposal(slug, title, description, content, assignee, startDate, dueDate);
    await logAudit(req, 'create_proposal', 'proposal', { slug, proposalId: proposal.id, title });
    return res.status(201).json(proposal);
  }
  res.status(405).json({ error: 'Method not allowed' });
}
