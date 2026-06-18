const { listNotifications, markAllRead } = require('../../../lib/notification-store')
const { getAuditUser } = require('../../../lib/audit-log')

export default async function handler(req, res) {
  const user = getAuditUser(req)
  if (!user || !user.name) return res.status(200).json([])

  if (req.method === 'GET') {
    return res.status(200).json(await listNotifications(user.name))
  }
  if (req.method === 'POST') {
    // mark all read
    return res.status(200).json(await markAllRead(user.name))
  }
  res.status(405).json({ error: 'Method not allowed' })
}
