const { requirePermission } = require('../../../../lib/require-permission')
const { createSnapshot, listSnapshots } = require('../../../../lib/snapshot-store')
const { logAudit } = require('../../../../lib/audit-log')
const { getSessionUser } = require('../../../../lib/session')

export default async function handler(req, res) {
  if (!await requirePermission('snapshot:manage')(req, res)) return

  if (req.method === 'GET') {
    const snapshots = await listSnapshots()
    return res.json(snapshots)
  }

  if (req.method === 'POST') {
    const { label } = req.body || {}
    const user = getSessionUser(req)
    const snapshot = await createSnapshot(label, user)
    await logAudit(req, 'create_snapshot', 'snapshot', { id: snapshot.id, label: snapshot.label })
    return res.json(snapshot)
  }

  res.status(405).end()
}
