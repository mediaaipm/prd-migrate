const { requirePermission } = require('../../../../lib/require-permission')
const { getSnapshot, deleteSnapshot } = require('../../../../lib/snapshot-store')
const { logAudit } = require('../../../../lib/audit-log')

export default async function handler(req, res) {
  if (!await requirePermission('snapshot:manage')(req, res)) return

  const { id } = req.query

  if (req.method === 'GET') {
    const snapshot = await getSnapshot(id)
    if (!snapshot) return res.status(404).json({ error: 'Snapshot not found' })
    return res.json(snapshot)
  }

  if (req.method === 'DELETE') {
    await deleteSnapshot(id)
    await logAudit(req, 'delete_snapshot', 'snapshot', { id })
    return res.json({ deleted: true })
  }

  res.status(405).end()
}
