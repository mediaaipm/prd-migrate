// Holidays + the working-week config. GLOBAL (org-wide), never per project —
// sprint analytics and any working-day maths read from here.
//
// Redis keys:
//   holidays:{year}        -> array of holiday objects (JSON string)
//   holidays-seeded:{year}  -> '1' marker, written the first time a year is seeded
//   holiday-config          -> { weekendDays: number[], country: string }
//
// The marker is why an admin who deletes every holiday in a year gets an empty
// year, not the built-in list back on the next read.
//
// ALL date maths in here is UTC/string based. `new Date('2026-01-01')` parses as
// UTC midnight but `new Date(2026, 0, 1)` and `.getDay()` are local, and mixing the
// two silently shifts a day for anyone east/west of UTC. Every date goes through
// parseISO -> Date.UTC and steps by whole days.
const { Redis } = require('@upstash/redis')
const { seedForYear, DEFAULT_CONFIG } = require('./holiday-seed')

let _kv
function getKv() { if (!_kv) _kv = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN }); return _kv }

const CONFIG_KEY = 'holiday-config'
const yearKey = year => `holidays:${year}`
const seededKey = year => `holidays-seeded:${year}`

const HOLIDAY_TYPES = ['public', 'optional', 'company']
const DAY_MS = 86400000
const MAX_RANGE_DAYS = 400
const MAX_RANGE_YEARS = 5
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/

class HolidayError extends Error {
  constructor(message, code = 'HOLIDAY_INPUT', status = 400) {
    super(message)
    this.name = 'HolidayError'
    this.code = code
    this.status = status
  }
}

/* ---------------------------------------------------------------- date utils */

const pad = n => String(n).padStart(2, '0')

// 'YYYY-MM-DD' -> UTC ms, or null when the string is malformed or the date does
// not exist (2026-02-31).
function parseISO(iso) {
  if (typeof iso !== 'string' || !ISO_RE.test(iso)) return null
  const y = Number(iso.slice(0, 4))
  const m = Number(iso.slice(5, 7))
  const d = Number(iso.slice(8, 10))
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const ms = Date.UTC(y, m - 1, d)
  const back = new Date(ms)
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return null
  return ms
}

function fromMs(ms) {
  const d = new Date(ms)
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

// Anything date-ish -> 'YYYY-MM-DD' (UTC calendar day), or null.
function toISODate(dateLike) {
  if (dateLike == null || dateLike === '') return null
  if (dateLike instanceof Date) {
    const t = dateLike.getTime()
    return Number.isFinite(t) ? fromMs(Date.UTC(dateLike.getUTCFullYear(), dateLike.getUTCMonth(), dateLike.getUTCDate())) : null
  }
  if (typeof dateLike === 'number') {
    return Number.isFinite(dateLike) ? toISODate(new Date(dateLike)) : null
  }
  const str = String(dateLike).trim()
  if (ISO_RE.test(str)) return parseISO(str) === null ? null : str
  const head = /^(\d{4}-\d{2}-\d{2})[T ]/.exec(str)
  if (head) return parseISO(head[1]) === null ? null : head[1]
  const parsed = new Date(str)
  if (Number.isNaN(parsed.getTime())) return null
  return toISODate(parsed)
}

function normalizeYear(value) {
  const y = Number.parseInt(value, 10)
  if (!Number.isFinite(y) || y < 1970 || y > 2200) return null
  return y
}

function normalizeWeekendDays(list) {
  if (!Array.isArray(list)) return null
  const out = []
  for (const raw of list) {
    const n = Number.parseInt(raw, 10)
    if (!Number.isFinite(n) || n < 0 || n > 6) continue
    if (!out.includes(n)) out.push(n)
  }
  return out.sort((a, b) => a - b)
}

// Accepts an ISO string or a Date. Day-of-week is always read in UTC.
function isWeekend(date, weekendDays) {
  const days = normalizeWeekendDays(weekendDays) || DEFAULT_CONFIG.weekendDays
  const iso = toISODate(date)
  const ms = parseISO(iso)
  if (ms === null) return false
  return days.includes(new Date(ms).getUTCDay())
}

// Only a non-optional holiday stops work. 'optional' (restricted) days stay
// working days for capacity maths.
function isHoliday(dateISO, holidayMap) {
  if (!holidayMap) return false
  const hit = holidayMap[dateISO]
  if (!hit) return false
  return hit.type !== 'optional'
}

// { 'YYYY-MM-DD': holiday }. When two holidays share a date the blocking one
// (non-optional) wins, so isHoliday() does not get shadowed by a restricted day.
function buildHolidayMap(holidays) {
  const map = {}
  for (const h of Array.isArray(holidays) ? holidays : []) {
    const date = toISODate(h && h.date)
    if (!date) continue
    const current = map[date]
    if (!current) { map[date] = h; continue }
    if (current.type === 'optional' && h.type !== 'optional') map[date] = h
  }
  return map
}

// Inclusive of both ends. [] when either end is unparseable or the range is
// reversed. Capped at MAX_RANGE_DAYS entries.
function eachDate(startISO, endISO) {
  const start = parseISO(toISODate(startISO))
  const end = parseISO(toISODate(endISO))
  if (start === null || end === null || end < start) return []
  const out = []
  for (let ms = start; ms <= end && out.length < MAX_RANGE_DAYS; ms += DAY_MS) out.push(fromMs(ms))
  return out
}

// Calendar days minus weekend days minus blocking holidays, inclusive of both
// ends. 0 for an invalid or reversed range.
function countWorkingDays(startISO, endISO, weekendDays, holidayMap) {
  const days = normalizeWeekendDays(weekendDays) || DEFAULT_CONFIG.weekendDays
  let count = 0
  for (const iso of eachDate(startISO, endISO)) {
    if (isWeekend(iso, days)) continue
    if (isHoliday(iso, holidayMap)) continue
    count += 1
  }
  return count
}

/* -------------------------------------------------------------- persistence */

function parseStored(raw) {
  if (raw == null) return null
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) return null
    try { return JSON.parse(trimmed) } catch { return null }
  }
  return raw
}

function newId() {
  return `hol-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeType(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  const type = String(value).trim().toLowerCase()
  if (!HOLIDAY_TYPES.includes(type)) {
    throw new HolidayError(`type must be one of ${HOLIDAY_TYPES.join(', ')}`)
  }
  return type
}

function shapeHoliday(src) {
  const s = src && typeof src === 'object' ? src : {}
  const date = toISODate(s.date)
  if (!date) return null
  const name = String(s.name == null ? '' : s.name).trim().slice(0, 120)
  if (!name) return null
  const type = HOLIDAY_TYPES.includes(s.type) ? s.type : 'public'
  return {
    id: s.id || newId(),
    date,
    name,
    type,
    recurring: !!s.recurring,
    source: s.source === 'seed' ? 'seed' : 'manual',
    createdAt: s.createdAt || new Date().toISOString(),
    updatedAt: s.updatedAt || s.createdAt || new Date().toISOString(),
  }
}

function sortHolidays(list) {
  return [...list].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.name).localeCompare(String(b.name))))
}

const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()

async function saveHolidays(year, list) {
  const sorted = sortHolidays(list.filter(Boolean))
  await getKv().set(yearKey(year), JSON.stringify(sorted))
  // Any write to a year counts as seeded — deleting the last row must not bring
  // the built-in list back on the next read.
  await getKv().set(seededKey(year), '1')
  return sorted
}

/* ------------------------------------------------------------------- config */

async function getHolidayConfig() {
  let stored = null
  try { stored = parseStored(await getKv().get(CONFIG_KEY)) } catch { stored = null }
  const src = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}
  const weekendDays = normalizeWeekendDays(src.weekendDays)
  const country = String(src.country == null ? '' : src.country).trim().slice(0, 32)
  return {
    weekendDays: weekendDays === null ? [...DEFAULT_CONFIG.weekendDays] : weekendDays,
    country: country || DEFAULT_CONFIG.country,
  }
}

// Only the keys present in `patch` are touched.
async function saveHolidayConfig(patch) {
  const p = patch && typeof patch === 'object' ? patch : {}
  const current = await getHolidayConfig()
  const next = { ...current }

  if (p.weekendDays !== undefined) {
    const days = normalizeWeekendDays(p.weekendDays)
    if (days === null) throw new HolidayError('weekendDays must be an array of day numbers 0-6')
    next.weekendDays = days
  }
  if (p.country !== undefined) {
    const country = String(p.country == null ? '' : p.country).trim().slice(0, 32)
    if (!country) throw new HolidayError('country is required')
    next.country = country
  }

  await getKv().set(CONFIG_KEY, JSON.stringify(next))
  return next
}

/* ----------------------------------------------------------------- holidays */

// First read of a year with no stored list seeds it from the built-in catalogue
// and persists both the list and the seeded marker.
async function getHolidays(year) {
  const y = normalizeYear(year)
  if (y === null) return []

  const stored = parseStored(await getKv().get(yearKey(y)))
  if (Array.isArray(stored)) return sortHolidays(stored.map(shapeHoliday).filter(Boolean))

  let seeded = null
  try { seeded = await getKv().get(seededKey(y)) } catch { seeded = null }
  if (seeded) return []

  const seeds = seedForYear(y)
    .map(h => shapeHoliday({ ...h, id: newId(), source: 'seed' }))
    .filter(Boolean)
  return saveHolidays(y, seeds)
}

// Merges every year the range spans (guarded to MAX_RANGE_YEARS), filtered to the
// range and sorted.
async function getHolidaysInRange(fromISO, toISO) {
  const from = toISODate(fromISO)
  const to = toISODate(toISO)
  if (!from || !to) return []
  if (parseISO(to) < parseISO(from)) return []

  const firstYear = normalizeYear(from.slice(0, 4))
  const lastRequested = normalizeYear(to.slice(0, 4))
  if (firstYear === null || lastRequested === null) return []
  const lastYear = Math.min(lastRequested, firstYear + MAX_RANGE_YEARS - 1)

  const years = []
  for (let y = firstYear; y <= lastYear; y += 1) years.push(y)
  const lists = await Promise.all(years.map(y => getHolidays(y)))
  const merged = lists.flat().filter(h => h.date >= from && h.date <= to)
  return sortHolidays(merged)
}

async function addHoliday(input) {
  const src = input && typeof input === 'object' ? input : {}

  const date = toISODate(src.date)
  if (!date) throw new HolidayError('date must be YYYY-MM-DD')

  const name = String(src.name == null ? '' : src.name).trim()
  if (!name) throw new HolidayError('name is required')
  if (name.length > 120) throw new HolidayError('name must be 120 characters or fewer')

  const type = normalizeType(src.type, 'public')
  const year = normalizeYear(date.slice(0, 4))
  if (year === null) throw new HolidayError('date is out of the supported range')

  const list = await getHolidays(year)
  if (list.some(h => h.date === date && sameName(h.name, name))) {
    throw new HolidayError('That holiday already exists on that date.', 'HOLIDAY_DUPLICATE', 409)
  }

  const holiday = shapeHoliday({
    id: newId(),
    date,
    name,
    type,
    recurring: !!src.recurring,
    source: 'manual',
  })
  await saveHolidays(year, [...list, holiday])
  return holiday
}

// Returns the updated holiday, or null when no row with that id lives in `year`.
// Editing the date into another year moves the row between the two year lists.
async function updateHoliday(year, id, patch) {
  const y = normalizeYear(year)
  if (y === null || !id) return null

  const list = await getHolidays(y)
  const idx = list.findIndex(h => h.id === id)
  if (idx < 0) return null
  const existing = list[idx]
  const p = patch && typeof patch === 'object' ? patch : {}

  let date = existing.date
  if (p.date !== undefined) {
    const next = toISODate(p.date)
    if (!next) throw new HolidayError('date must be YYYY-MM-DD')
    date = next
  }

  let name = existing.name
  if (p.name !== undefined) {
    name = String(p.name == null ? '' : p.name).trim()
    if (!name) throw new HolidayError('name is required')
    if (name.length > 120) throw new HolidayError('name must be 120 characters or fewer')
  }

  const type = p.type !== undefined ? normalizeType(p.type, existing.type) : existing.type
  const recurring = p.recurring !== undefined ? !!p.recurring : existing.recurring

  const updated = shapeHoliday({
    ...existing,
    date,
    name,
    type,
    recurring,
    updatedAt: new Date().toISOString(),
  })
  if (!updated) throw new HolidayError('holiday is missing a date or a name')

  const targetYear = normalizeYear(date.slice(0, 4))
  if (targetYear === null) throw new HolidayError('date is out of the supported range')

  if (targetYear === y) {
    if (list.some((h, i) => i !== idx && h.date === date && sameName(h.name, name))) {
      throw new HolidayError('That holiday already exists on that date.', 'HOLIDAY_DUPLICATE', 409)
    }
    const next = list.slice()
    next[idx] = updated
    await saveHolidays(y, next)
    return updated
  }

  const targetList = await getHolidays(targetYear)
  if (targetList.some(h => h.date === date && sameName(h.name, name))) {
    throw new HolidayError('That holiday already exists on that date.', 'HOLIDAY_DUPLICATE', 409)
  }
  await saveHolidays(y, list.filter((_, i) => i !== idx))
  await saveHolidays(targetYear, [...targetList, updated])
  return updated
}

async function deleteHoliday(year, id) {
  const y = normalizeYear(year)
  if (y === null || !id) return false
  const list = await getHolidays(y)
  const next = list.filter(h => h.id !== id)
  if (next.length === list.length) return false
  await saveHolidays(y, next)
  return true
}

// [{ date, name, type, daysAway }] — the next `days` days from `fromISO`.
async function upcomingHolidays(fromISO, days = 60, limit = 8) {
  const from = toISODate(fromISO) || toISODate(new Date())
  const start = parseISO(from)
  if (start === null) return []

  const span = Number.parseInt(days, 10)
  const window = Math.max(1, Math.min(MAX_RANGE_DAYS - 1, Number.isFinite(span) ? span : 60))
  const cap = Number.parseInt(limit, 10)
  const max = Math.max(1, Math.min(100, Number.isFinite(cap) ? cap : 8))

  const list = await getHolidaysInRange(from, fromMs(start + window * DAY_MS))
  return list.slice(0, max).map(h => ({
    date: h.date,
    name: h.name,
    type: h.type,
    daysAway: Math.round((parseISO(h.date) - start) / DAY_MS),
  }))
}

module.exports = {
  HolidayError,
  HOLIDAY_TYPES,
  getHolidayConfig,
  saveHolidayConfig,
  getHolidays,
  getHolidaysInRange,
  addHoliday,
  updateHoliday,
  deleteHoliday,
  isWeekend,
  isHoliday,
  buildHolidayMap,
  countWorkingDays,
  eachDate,
  upcomingHolidays,
  toISODate,
  normalizeWeekendDays,
  normalizeYear,
}
