const { listLabels, createLabel, updateLabel, deleteLabel } = require('../../../../lib/prd-store')
const { logAudit } = require('../../../../lib/audit-log')
const { requirePermission, requireProjectAccess } = require('../../../../lib/require-permission')

export default async function handler(req, res) {
  const { slug, id } = req.query
  if (!await requireProjectAccess(slug, req, res)) return

  if (req.method === 'GET') {
    return res.status(200).json(await listLabels(slug))
  }
  if (req.method === 'POST') {
    if (!requirePermission('task:update')(req, res)) return
    const { name, color } = req.body || {}
    const label = await createLabel(slug, name, color)
    await logAudit(req, 'create_label', 'label', { slug, name: label.name })
    return res.status(201).json(label)
  }
  if (req.method === 'PUT') {
    if (!requirePermission('task:update')(req, res)) return
    const label = await updateLabel(slug, id, req.body || {})
    if (!label) return res.status(404).json({ error: 'Not found' })
    return res.status(200).json(label)
  }
  if (req.method === 'DELETE') {
    if (!requirePermission('task:update')(req, res)) return
    const ok = await deleteLabel(slug, id)
    if (!ok) return res.status(404).json({ error: 'Not found' })
    await logAudit(req, 'delete_label', 'label', { slug, id })
    return res.status(200).json({ deleted: true })
  }
  res.status(405).json({ error: 'Method not allowed' })
}
