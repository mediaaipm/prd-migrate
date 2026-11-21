const { getBoardColumns, setBoardColumns } = require('../../../../lib/prd-store')
const { statusCounts } = require('../../../../lib/task-store')
const { logAudit } = require('../../../../lib/audit-log')
const { requireProjectAccess } = require('../../../../lib/require-permission')
const { requireSuperAdmin } = require('../../../../lib/require-superadmin')
const { sendJsonConfig } = require('../../../../lib/etag')

// The board layout is global per project: everyone reads it, only a super admin
// writes it. Column order/labels/colors are therefore identical for all users.
export default async function handler(req, res) {
  const { slug } = req.query
  if (!await requireProjectAccess(slug, req, res)) return

  if (req.method === 'GET') {
    return sendJsonConfig(res, { columns: await getBoardColumns(slug) })
  }
  if (req.method === 'PUT') {
    if (!requireSuperAdmin(req, res)) return
    const next = (req.body || {}).columns
    if (!Array.isArray(next) || !next.length) {
      return res.status(400).json({ error: 'columns must be a non-empty array of { status, label, color }' })
    }

    // A column that still holds tasks may never be dropped. The client checks the
    // same thing, but only against the version it is showing and only for cards it
    // is not hiding — this counts every version and every archived task, so a
    // status with work parked in it survives no matter which board asked.
    const current = await getBoardColumns(slug)
    if (current) {
      const keeping = new Set(next.map(c => c && typeof c.status === 'string' ? c.status.trim() : '').filter(Boolean))
      const removed = current.map(c => c.status).filter(s => !keeping.has(s))
      if (removed.length) {
        const counts = await statusCounts(slug)
        const occupied = removed.filter(s => counts[s] > 0)
        if (occupied.length) {
          return res.status(409).json({
            error: occupied
              .map(s => `${counts[s]} task${counts[s] === 1 ? '' : 's'} still in "${s}"`)
              .join(', ') + '. Move them before deleting the column.',
            occupied: Object.fromEntries(occupied.map(s => [s, counts[s]])),
          })
        }
      }
    }

    const columns = await setBoardColumns(slug, next)
    if (!columns) return res.status(400).json({ error: 'columns must be a non-empty array of { status, label, color }' })
    await logAudit(req, 'update_columns', 'project', { slug, order: columns.map(c => c.status) })
    return res.status(200).json({ columns })
  }
  res.status(405).json({ error: 'Method not allowed' })
}
