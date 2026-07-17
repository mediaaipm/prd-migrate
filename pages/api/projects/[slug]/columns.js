const { getBoardColumns, setBoardColumns } = require('../../../../lib/prd-store')
const { logAudit } = require('../../../../lib/audit-log')
const { requireProjectAccess } = require('../../../../lib/require-permission')
const { requireSuperAdmin } = require('../../../../lib/require-superadmin')

// The board layout is global per project: everyone reads it, only a super admin
// writes it. Column order/labels/colors are therefore identical for all users.
export default async function handler(req, res) {
  const { slug } = req.query
  if (!await requireProjectAccess(slug, req, res)) return

  if (req.method === 'GET') {
    return res.status(200).json({ columns: await getBoardColumns(slug) })
  }
  if (req.method === 'PUT') {
    if (!requireSuperAdmin(req, res)) return
    const columns = await setBoardColumns(slug, (req.body || {}).columns)
    if (!columns) return res.status(400).json({ error: 'columns must be a non-empty array of { status, label, color }' })
    await logAudit(req, 'update_columns', 'project', { slug, order: columns.map(c => c.status) })
    return res.status(200).json({ columns })
  }
  res.status(405).json({ error: 'Method not allowed' })
}
