const { getSessionUser } = require('../../../lib/session')
const { requirePermission } = require('../../../lib/require-permission')
const { logAudit } = require('../../../lib/audit-log')
const {
  HolidayError,
  getHolidayConfig,
  getHolidays,
  getHolidaysInRange,
  addHoliday,
  updateHoliday,
  deleteHoliday,
  toISODate,
  normalizeYear,
} = require('../../../lib/holiday-store')

// Org-wide holiday calendar. Reading is open to any signed-in account (the sprint
// views need it); writing needs the global `holiday:manage` permission — there is
// no project slug, holidays are not per project.

function fail(res, err) {
  if (err instanceof HolidayError) {
    return res.status(err.status || 400).json({ error: err.message, code: err.code })
  }
  throw err
}

// `year` may ride in the query or the body; failing that we derive it from the
// body's date. Anything else is a 400 — we do not scan years looking for an id.
function resolveYear(req) {
  const body = req.body && typeof req.body === 'object' ? req.body : {}
  const fromQuery = normalizeYear(req.query.year)
  if (fromQuery !== null) return fromQuery
  const fromBody = normalizeYear(body.year)
  if (fromBody !== null) return fromBody
  const date = toISODate(body.date)
  if (date) return normalizeYear(date.slice(0, 4))
  return null
}

function resolveId(req) {
  const body = req.body && typeof req.body === 'object' ? req.body : {}
  const id = req.query.id || body.id
  return id ? String(id).trim() : ''
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    if (!getSessionUser(req)) return res.status(401).json({ error: 'Not signed in.' })
    const { weekendDays, country } = await getHolidayConfig()

    const from = req.query.from ? toISODate(req.query.from) : null
    const to = req.query.to ? toISODate(req.query.to) : null
    if (req.query.from || req.query.to) {
      if (!from || !to) return res.status(400).json({ error: 'from and to must both be YYYY-MM-DD.' })
      const holidays = await getHolidaysInRange(from, to)
      return res.json({ from, to, weekendDays, country, holidays })
    }

    const year = normalizeYear(req.query.year) ?? new Date().getUTCFullYear()
    const holidays = await getHolidays(year)
    return res.json({ year, weekendDays, country, holidays })
  }

  if (req.method === 'POST') {
    if (!await requirePermission('holiday:manage')(req, res)) return
    const { date, name, type, recurring } = req.body || {}
    try {
      const holiday = await addHoliday({ date, name, type, recurring })
      await logAudit(req, 'create_holiday', 'holiday', { id: holiday.id, date: holiday.date, name: holiday.name, type: holiday.type })
      return res.status(201).json(holiday)
    } catch (err) {
      return fail(res, err)
    }
  }

  if (req.method === 'PUT') {
    if (!await requirePermission('holiday:manage')(req, res)) return
    const id = resolveId(req)
    if (!id) return res.status(400).json({ error: 'id is required.' })
    const year = resolveYear(req)
    if (year === null) return res.status(400).json({ error: 'year is required.' })

    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const patch = {}
    for (const field of ['date', 'name', 'type', 'recurring']) {
      if (body[field] !== undefined) patch[field] = body[field]
    }
    try {
      const holiday = await updateHoliday(year, id, patch)
      if (!holiday) return res.status(404).json({ error: 'Holiday not found.' })
      await logAudit(req, 'update_holiday', 'holiday', { id: holiday.id, year, date: holiday.date, name: holiday.name, type: holiday.type })
      return res.json(holiday)
    } catch (err) {
      return fail(res, err)
    }
  }

  if (req.method === 'DELETE') {
    if (!await requirePermission('holiday:manage')(req, res)) return
    const id = resolveId(req)
    if (!id) return res.status(400).json({ error: 'id is required.' })
    const year = resolveYear(req)
    if (year === null) return res.status(400).json({ error: 'year is required.' })

    try {
      const removed = await deleteHoliday(year, id)
      if (!removed) return res.status(404).json({ error: 'Holiday not found.' })
      await logAudit(req, 'delete_holiday', 'holiday', { id, year })
      return res.json({ ok: true, id, year })
    } catch (err) {
      return fail(res, err)
    }
  }

  res.status(405).end()
}
