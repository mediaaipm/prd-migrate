const { markRead } = require('../../../lib/notification-store')
const { getAuditUser } = require('../../../lib/audit-log')

export default async function handler(req, res) {
  const user = getAuditUser(req)
  if (!user || !user.name) return res.status(401).json({ error: 'Unauthorized' })

  if (req.method === 'PATCH') {
    await markRead(user.name, req.query.id)
    return res.status(200).json({ ok: true })
  }
  res.status(405).json({ error: 'Method not allowed' })
}
