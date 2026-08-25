// Built-in holiday catalogue used to auto-seed a year that has none.
//
// BEST-EFFORT DEFAULTS. Most Indian festival holidays follow a lunar calendar, so
// their Gregorian date shifts every year and is confirmed only when the official
// gazette is published. The dates below are our best-known values and WILL be a day
// off in places. They are a starting point, not an authority — an admin is expected
// to correct them in Admin -> Holidays, where every seeded row is editable and
// deletable like a manually added one. Years we have no table for simply seed the
// fixed-date recurring set.

// Fixed-date holidays that repeat every year — generated for ANY year.
const RECURRING = [
  { month: 1, day: 1, name: "New Year's Day", type: 'public' },
  { month: 1, day: 26, name: 'Republic Day', type: 'public' },
  { month: 5, day: 1, name: 'Labour Day', type: 'optional' },
  { month: 8, day: 15, name: 'Independence Day', type: 'public' },
  { month: 10, day: 2, name: 'Gandhi Jayanti', type: 'public' },
  { month: 12, day: 25, name: 'Christmas', type: 'public' },
]

// Year -> the dated holidays whose date moves. Extend this map as new years are
// gazetted; an unknown year just gets the RECURRING set.
const FIXED_BY_YEAR = {
  2025: [
    { date: '2025-03-14', name: 'Holi', type: 'public' },
    { date: '2025-03-31', name: 'Eid-ul-Fitr', type: 'public' },
    { date: '2025-04-18', name: 'Good Friday', type: 'public' },
    { date: '2025-08-09', name: 'Raksha Bandhan', type: 'optional' },
    { date: '2025-08-16', name: 'Janmashtami', type: 'public' },
    { date: '2025-08-27', name: 'Ganesh Chaturthi', type: 'optional' },
    { date: '2025-10-02', name: 'Dussehra', type: 'public' },
    { date: '2025-10-20', name: 'Diwali', type: 'public' },
    { date: '2025-11-05', name: 'Guru Nanak Jayanti', type: 'public' },
  ],
  2026: [
    { date: '2026-03-04', name: 'Holi', type: 'public' },
    { date: '2026-03-20', name: 'Eid-ul-Fitr', type: 'public' },
    { date: '2026-04-03', name: 'Good Friday', type: 'public' },
    { date: '2026-08-28', name: 'Raksha Bandhan', type: 'optional' },
    { date: '2026-09-04', name: 'Janmashtami', type: 'public' },
    { date: '2026-09-14', name: 'Ganesh Chaturthi', type: 'optional' },
    { date: '2026-10-20', name: 'Dussehra', type: 'public' },
    { date: '2026-11-08', name: 'Diwali', type: 'public' },
    { date: '2026-11-24', name: 'Guru Nanak Jayanti', type: 'public' },
  ],
  2027: [
    { date: '2027-03-10', name: 'Eid-ul-Fitr', type: 'public' },
    { date: '2027-03-22', name: 'Holi', type: 'public' },
    { date: '2027-03-26', name: 'Good Friday', type: 'public' },
    { date: '2027-08-17', name: 'Raksha Bandhan', type: 'optional' },
    { date: '2027-08-25', name: 'Janmashtami', type: 'public' },
    { date: '2027-09-04', name: 'Ganesh Chaturthi', type: 'optional' },
    { date: '2027-10-09', name: 'Dussehra', type: 'public' },
    { date: '2027-10-29', name: 'Diwali', type: 'public' },
    { date: '2027-11-13', name: 'Guru Nanak Jayanti', type: 'public' },
  ],
}

const DEFAULT_CONFIG = { weekendDays: [0, 6], country: 'IN' }

const pad = n => String(n).padStart(2, '0')

function toYear(value) {
  const y = Number.parseInt(value, 10)
  if (!Number.isFinite(y) || y < 1970 || y > 2200) return null
  return y
}

// RECURRING mapped onto `year` + FIXED_BY_YEAR[year], sorted by date and
// de-duplicated on date+name (Dussehra landing on Gandhi Jayanti keeps both rows,
// the same holiday listed twice keeps one).
function seedForYear(year) {
  const y = toYear(year)
  if (y === null) return []

  const rows = [
    ...RECURRING.map(h => ({
      date: `${y}-${pad(h.month)}-${pad(h.day)}`,
      name: h.name,
      type: h.type,
      recurring: true,
    })),
    ...(FIXED_BY_YEAR[y] || []).map(h => ({
      date: h.date,
      name: h.name,
      type: h.type || 'public',
      recurring: false,
    })),
  ]

  const seen = new Set()
  const out = []
  for (const row of rows) {
    const key = `${row.date}|${row.name.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name)))
  return out
}

module.exports = {
  RECURRING,
  FIXED_BY_YEAR,
  DEFAULT_CONFIG,
  seedForYear,
}
