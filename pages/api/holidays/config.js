const { getSessionUser } = require('../../../lib/session')
const { requireSuperAdmin } = require('../../../lib/require-superadmin')
const { logAudit } = require('../../../lib/audit-log')
const { HolidayError, getHolidayConfig, saveHolidayConfig } = require('../../../lib/holiday-store')

// The org's working week: which weekday numbers count as the weekend (0=Sun..6=Sat)
// and the country the seeded holiday list belongs to. Read by anyone signed in —
// every working-day calculation depends on it — but only a superadmin may change it.
export default async function handler(req, res) {
  if (req.method === 'GET') {
    if (!getSessionUser(req)) return res.status(401).json({ error: 'Not signed in.' })
    return res.json(await getHolidayConfig())
  }

  if (req.method === 'PUT') {
    if (!requireSuperAdmin(req, res)) return
    const { weekendDays, country } = req.body || {}
    const patch = {}
    if (weekendDays !== undefined) patch.weekendDays = weekendDays
    if (country !== undefined) patch.country = country
    try {
      const config = await saveHolidayConfig(patch)
      await logAudit(req, 'update_holiday_config', 'holiday', { weekendDays: config.weekendDays, country: config.country })
      return res.json(config)
    } catch (err) {
      if (err instanceof HolidayError) return res.status(err.status || 400).json({ error: err.message, code: err.code })
      throw err
    }
  }

  res.status(405).end()
}
