const { getSessionUser } = require('./session')

function requireAdmin(req, res) {
  const user = getSessionUser(req) || {}
  if (user.role === 'admin' || user.role === 'superadmin' || user.isAdmin === true) return true
  res.status(403).json({ error: 'Admin access required.' })
  return false
}

module.exports = { requireAdmin }
