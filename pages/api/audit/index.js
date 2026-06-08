import { getAuditLogs } from '../../../lib/audit-log'
import { requirePermission } from '../../../lib/require-permission'

export default async function handler(req, res) {
  if (req.method === 'GET') {
    if (!requirePermission('audit:view')(req, res)) return
    const limit = Math.min(parseInt(req.query.limit) || 100, 500)
    const offset = parseInt(req.query.offset) || 0
    const result = await getAuditLogs({ limit, offset })
    return res.json(result)
  }
  res.status(405).end()
}
