const { requirePermission } = require('../../../../lib/require-permission')
const { getSnapshot, summarizeSnapshot, deleteSnapshot } = require('../../../../lib/snapshot-store')
const { logAudit } = require('../../../../lib/audit-log')

export default async function handler(req, res) {
  if (!await requirePermission('snapshot:manage')(req, res)) return

  const { id, full } = req.query

  if (req.method === 'GET') {
    const snapshot = await getSnapshot(id)
    if (!snapshot) return res.status(404).json({ error: 'Snapshot not found' })
    // Summary by default — the full payload embeds every task and attachment and
    // is only needed for an actual restore/export, never for the admin listing.
    return res.json(full === '1' ? snapshot : summarizeSnapshot(snapshot))
  }

  if (req.method === 'DELETE') {
    await deleteSnapshot(id)
    await logAudit(req, 'delete_snapshot', 'snapshot', { id })
    return res.json({ deleted: true })
  }

  res.status(405).end()
}
