const { listNotifications, markAllRead } = require('../../../lib/notification-store')
const { getAuditUser } = require('../../../lib/audit-log')
const { withCpuLog } = require('../../../lib/cpu-log')

async function handler(req, res) {
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

// The app's highest-volume route by a wide margin — Nav polls it on a timer, so it
// is the one whose invocation count matters more than its per-call cost.
export default withCpuLog(handler, '/api/notifications')
