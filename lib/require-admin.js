function requireAdmin(req, res) {
  try {
    const user = JSON.parse(req.headers['x-user'] || '{}')
    if (user.role === 'admin' || user.role === 'superadmin' || user.isAdmin === true) return true
  } catch {}
  res.status(403).json({ error: 'Admin access required.' })
  return false
}

module.exports = { requireAdmin }
