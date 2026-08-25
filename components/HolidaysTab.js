import { useState, useEffect, useRef } from 'react'
import { apiFetch } from '../lib/api-fetch'
import { hasPerm, isSuperAdmin } from '../lib/client-permissions'

// Org-wide holiday calendar (Admin → Holidays).
//
// The list is global, not per project: sprint analytics subtracts these dates —
// plus the weekly off days configured here — from a sprint's working days.
//
// A year that has never been opened is seeded server-side from a built-in list on
// its first GET, so the list always comes back populated. Seeded rows are ordinary
// rows: editable and deletable like anything typed in by hand, which is why the
// toolbar says so out loud.
//
// Reading is open to every signed-in account; editing needs `holiday:manage` (or
// superadmin), and the weekly-off picker is superadmin-only. All three gates are
// enforced server-side — the checks here only hide controls the API would refuse.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DOW_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const TYPE_LABELS = { public: 'Public holiday', optional: 'Optional', company: 'Company holiday' }
const TYPES = ['public', 'optional', 'company']

// A holiday date is a plain calendar date, never an instant. `new Date('2026-01-26')`
// parses as UTC midnight, so local getDay()/getDate() read the *previous* day
// anywhere west of Greenwich — split the string and go through Date.UTC instead.
function ymd(date) {
  if (!DATE_RE.test(date || '')) return null
  const [y, m, d] = date.split('-').map(Number)
  if (!m || m > 12 || !d || d > 31) return null
  return { y, m, d }
}

function dowOf(date) {
  const p = ymd(date)
  if (!p) return null
  return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()
}

// Ascending by date, then grouped into the months that actually have something.
function groupByMonth(holidays) {
  const byKey = new Map()
  const groups = []
  for (const h of holidays) {
    const p = ymd(h.date)
    if (!p) continue
    const key = `${p.y}-${String(p.m).padStart(2, '0')}`
    let g = byKey.get(key)
    if (!g) {
      g = { key, year: p.y, month: p.m, items: [] }
      byKey.set(key, g)
      groups.push(g)
    }
    g.items.push(h)
  }
  groups.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  for (const g of groups) {
    g.items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  }
  return groups
}

function emptyDraft(type = 'public') {
  return { date: '', name: '', type, recurring: false }
}

function validate(draft, minYear, maxYear) {
  const date = (draft.date || '').trim()
  const name = (draft.name || '').trim()
  if (!date) return 'Pick a date.'
  if (!DATE_RE.test(date)) return 'Date must be in YYYY-MM-DD form.'
  const p = ymd(date)
  if (!p) return 'That is not a real date.'
  // A date in another year is allowed — the store moves the row between year keys
  // and the view follows it — but only inside the range the arrows can reach, or the
  // row would land somewhere the user cannot navigate to.
  if (p.y < minYear || p.y > maxYear) return `Date must fall between ${minYear} and ${maxYear}.`
  if (!name) return 'Give the holiday a name.'
  if (name.length > 120) return 'Name must be 120 characters or fewer.'
  return ''
}

// The add row and the inline edit row are the same four fields, so they are the
// same component — a holiday edited in place can never drift from one created.
function HolidayFields({ value, onChange, minYear, maxYear, onSubmit, onCancel, submitLabel, busy }) {
  function set(key, isCheck) {
    return e => onChange({ ...value, [key]: isCheck ? e.target.checked : e.target.value })
  }

  return (
    <div className="holiday-form-row">
      <input
        type="date"
        className="form-input"
        aria-label="Holiday date"
        value={value.date || ''}
        min={`${minYear}-01-01`}
        max={`${maxYear}-12-31`}
        onChange={set('date')}
      />
      <input
        className="form-input"
        aria-label="Holiday name"
        placeholder="Holiday name *"
        maxLength={120}
        value={value.name || ''}
        onChange={set('name')}
        onKeyDown={e => { if (e.key === 'Enter' && !busy) onSubmit() }}
      />
      <select className="form-input" aria-label="Holiday type" value={value.type || 'public'} onChange={set('type')}>
        {TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
      </select>
      <label className="holiday-form-check task-form-hint" title="Generate this holiday on the same date in every year">
        <input type="checkbox" checked={!!value.recurring} onChange={set('recurring', true)} />
        {' '}repeats every year
      </label>
      <button className="btn-primary" style={{ fontSize: 12 }} onClick={onSubmit} disabled={busy}>
        {submitLabel}
      </button>
      {onCancel && (
        <button className="btn-ghost" style={{ fontSize: 12 }} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      )}
    </div>
  )
}

export default function HolidaysTab({ currentUser }) {
  const currentYear = new Date().getFullYear()
  const minYear = currentYear - 1
  const maxYear = currentYear + 3

  const superAdmin = isSuperAdmin(currentUser)
  const canManage = superAdmin || hasPerm(currentUser, 'holiday:manage')

  const [year, setYear] = useState(currentYear)
  const [holidays, setHolidays] = useState([])
  const [weekendDays, setWeekendDays] = useState([0, 6])
  const [country, setCountry] = useState('IN')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [addError, setAddError] = useState('')
  const [editError, setEditError] = useState('')
  const [draft, setDraft] = useState(emptyDraft())
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState(emptyDraft())

  // The year the newest request belongs to. A slow answer for a year the user has
  // already paged away from is dropped rather than painted over the current one.
  const yearRef = useRef(year)

  useEffect(() => {
    setEditingId(null)
    setAddError('')
    setEditError('')
    load(year)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year])

  async function load(y, { silent = false } = {}) {
    yearRef.current = y
    if (!silent) setLoading(true)
    try {
      const res = await apiFetch(`/api/holidays?year=${y}`)
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || `Could not load ${y} (${res.status}).`)
      }
      const data = await res.json()
      if (yearRef.current !== y) return
      setHolidays(Array.isArray(data.holidays) ? data.holidays : [])
      if (Array.isArray(data.weekendDays)) setWeekendDays(data.weekendDays)
      if (typeof data.country === 'string') setCountry(data.country)
      setError('')
    } catch (err) {
      if (yearRef.current !== y) return
      setError(err.message || 'Could not load the holiday list.')
    } finally {
      if (yearRef.current === y && !silent) setLoading(false)
    }
  }

  // Paint the change first, send it, then re-read the year the server now holds.
  // A rejection puts the previous list straight back and says why inline.
  // `targetYear` is the year the row ends up in. It differs from the year on screen
  // only when an edit moved a holiday across a year boundary — then the view follows
  // the row instead of leaving the user staring at the list it just left.
  async function mutate(optimisticList, request, fallbackMessage, setMessage, targetYear) {
    const before = holidays
    setMessage('')
    setError('')
    setHolidays(optimisticList)
    setBusy(true)
    try {
      const res = await apiFetch(request.url, {
        method: request.method,
        ...(request.body
          ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request.body) }
          : {}),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || `${fallbackMessage} (${res.status})`)
      }
      if (targetYear != null && targetYear !== yearRef.current) setYear(targetYear)
      else await load(yearRef.current, { silent: true })
      return true
    } catch (err) {
      setHolidays(before)
      setMessage(err.message || fallbackMessage)
      return false
    } finally {
      setBusy(false)
    }
  }

  async function handleAdd() {
    const msg = validate(draft, minYear, maxYear)
    if (msg) { setAddError(msg); return }
    const targetYear = ymd(draft.date.trim()).y
    const body = {
      date: draft.date.trim(),
      name: draft.name.trim(),
      type: draft.type || 'public',
      recurring: !!draft.recurring,
    }
    // A row destined for another year must not be painted into this one first.
    const optimistic = targetYear === year
      ? [...holidays, { ...body, id: `pending-${Date.now()}`, source: 'manual' }]
      : holidays
    const ok = await mutate(
      optimistic,
      { url: '/api/holidays', method: 'POST', body },
      'Could not add the holiday.',
      setAddError,
      targetYear,
    )
    if (ok) setDraft(emptyDraft(body.type))
  }

  async function handleSaveEdit(holiday) {
    const msg = validate(editDraft, minYear, maxYear)
    if (msg) { setEditError(msg); return }
    const targetYear = ymd(editDraft.date.trim()).y
    const body = {
      date: editDraft.date.trim(),
      name: editDraft.name.trim(),
      type: editDraft.type || 'public',
      recurring: !!editDraft.recurring,
    }
    // Moving to another year removes it from this list rather than editing it in place.
    const optimistic = targetYear === year
      ? holidays.map(h => (h.id === holiday.id ? { ...h, ...body } : h))
      : holidays.filter(h => h.id !== holiday.id)
    const ok = await mutate(
      optimistic,
      {
        url: `/api/holidays?id=${encodeURIComponent(holiday.id)}&year=${year}`,
        method: 'PUT',
        body,
      },
      'Could not save the holiday.',
      setEditError,
      targetYear,
    )
    if (ok) { setEditingId(null); setEditError('') }
  }

  async function handleDelete(holiday) {
    if (!confirm(`Delete "${holiday.name}" on ${holiday.date}?`)) return
    await mutate(
      holidays.filter(h => h.id !== holiday.id),
      { url: `/api/holidays?id=${encodeURIComponent(holiday.id)}&year=${year}`, method: 'DELETE' },
      'Could not delete the holiday.',
      setError,
    )
  }

  async function toggleWeekend(idx) {
    if (!superAdmin || busy) return
    const before = weekendDays
    const next = before.includes(idx)
      ? before.filter(d => d !== idx)
      : [...before, idx].sort((a, b) => a - b)
    setWeekendDays(next)
    setError('')
    setBusy(true)
    try {
      const res = await apiFetch('/api/holidays/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekendDays: next, country }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || `Could not save the weekly off days (${res.status}).`)
      }
      await load(yearRef.current, { silent: true })
    } catch (err) {
      setWeekendDays(before)
      setError(err.message || 'Could not save the weekly off days.')
    } finally {
      setBusy(false)
    }
  }

  function startEdit(h) {
    setEditingId(h.id)
    setEditError('')
    setEditDraft({ date: h.date || '', name: h.name || '', type: h.type || 'public', recurring: !!h.recurring })
  }

  const months = groupByMonth(holidays)

  return (
    <section className="section-card holiday-admin" style={{ marginTop: 0, borderRadius: '0 6px 6px 6px' }}>
      <div className="section-card-header">
        <span>Holidays</span>
        {!loading && <span className="badge">{holidays.length}</span>}
      </div>

      <div className="holiday-toolbar">
        <div className="holiday-year-nav">
          <button
            className="holiday-year-btn"
            title="Previous year"
            aria-label="Previous year"
            onClick={() => setYear(y => Math.max(minYear, y - 1))}
            disabled={year <= minYear}
          >
            ‹
          </button>
          <span className="holiday-year-value">{year}</span>
          <button
            className="holiday-year-btn"
            title="Next year"
            aria-label="Next year"
            onClick={() => setYear(y => Math.min(maxYear, y + 1))}
            disabled={year >= maxYear}
          >
            ›
          </button>
        </div>
        <span className="badge">{loading ? '…' : `${holidays.length} holiday${holidays.length === 1 ? '' : 's'}`}</span>
        <span className="holiday-hint task-form-hint">
          {year} was seeded automatically{country ? ` for ${country}` : ''} — correct anything that is wrong.
        </span>
      </div>

      <div className="holiday-weekend">
        <span className="holiday-weekend-label task-form-hint">Weekly off</span>
        {DOW_LETTER.map((letter, i) => {
          const active = weekendDays.includes(i)
          return (
            <button
              key={i}
              type="button"
              className={`holiday-weekend-day${active ? ' active' : ''}`}
              title={superAdmin ? `${DOW_FULL[i]} — ${active ? 'a weekly off' : 'a working day'}` : DOW_FULL[i]}
              aria-pressed={active}
              disabled={!superAdmin || busy}
              onClick={() => toggleWeekend(i)}
            >
              {letter}
            </button>
          )
        })}
        <span className="holiday-weekend-note task-form-hint">
          {superAdmin
            ? 'Sprint working days skip these days and every holiday below.'
            : 'Super admin only — sprint working days skip these days.'}
        </span>
      </div>

      {error && (
        <div className="holiday-error" style={{ padding: '8px 16px', fontSize: 12, color: 'var(--tint-red-fg)' }}>
          {error}
        </div>
      )}

      {canManage && (
        <div className="holiday-form">
          <HolidayFields
            value={draft}
            onChange={setDraft}
            minYear={minYear}
            maxYear={maxYear}
            onSubmit={handleAdd}
            submitLabel="Add holiday"
            busy={busy}
          />
          {addError && (
            <div className="holiday-error" style={{ fontSize: 12, color: 'var(--tint-red-fg)' }}>{addError}</div>
          )}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[0, 1, 2, 3].map(i => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="skeleton" style={{ width: 34, height: 34, borderRadius: 6 }} />
              <span className="skeleton" style={{ width: `${35 + i * 12}%`, height: 12 }} />
              <span className="skeleton" style={{ width: 70, height: 18, borderRadius: 20, marginLeft: 'auto' }} />
            </div>
          ))}
        </div>
      ) : holidays.length === 0 ? (
        <div className="holiday-empty empty-state-sm" style={{ padding: '20px 16px' }}>
          Nothing on the calendar for {year}.
          {canManage ? ' Add the first one above.' : ''}
        </div>
      ) : (
        <div className="holiday-list">
          {months.map(g => (
            <div className="holiday-month" key={g.key}>
              <div className="holiday-month-head">
                <span>{MONTHS[g.month - 1]} {g.year}</span>
                <span className="badge">{g.items.length}</span>
              </div>

              {g.items.map(h => {
                const p = ymd(h.date)
                const dow = dowOf(h.date)
                const onWeekend = dow != null && weekendDays.includes(dow)
                const type = TYPES.includes(h.type) ? h.type : 'public'

                if (editingId === h.id) {
                  return (
                    <div className="holiday-item is-editing" key={h.id}>
                      <div className="holiday-form" style={{ flex: 1 }}>
                        <HolidayFields
                          value={editDraft}
                          onChange={setEditDraft}
                          minYear={minYear}
                          maxYear={maxYear}
                          onSubmit={() => handleSaveEdit(h)}
                          onCancel={() => { setEditingId(null); setEditError('') }}
                          submitLabel="Save"
                          busy={busy}
                        />
                        {editError && (
                          <div className="holiday-error" style={{ fontSize: 12, color: 'var(--tint-red-fg)' }}>{editError}</div>
                        )}
                      </div>
                    </div>
                  )
                }

                return (
                  <div className="holiday-item" key={h.id}>
                    <span className="holiday-item-date">{p ? p.d : '?'}</span>
                    <span className="holiday-item-dow">{dow == null ? '' : DOW_SHORT[dow]}</span>
                    <span className="holiday-item-name">
                      {h.name}
                      {h.recurring && <span className="holiday-item-repeat holiday-item-src" title="Repeats on this date every year"> ↻</span>}
                      {onWeekend && (
                        <span className="holiday-item-note task-form-hint"> · falls on a weekend</span>
                      )}
                    </span>
                    <span className={`holiday-item-badge is-${type}`}>{TYPE_LABELS[type]}</span>
                    {h.source === 'seed' && (
                      <span className="holiday-item-src" title="Added automatically when this year was first opened">seeded</span>
                    )}
                    {canManage && (
                      <span className="holiday-item-actions">
                        <button className="btn-ghost" style={{ fontSize: 12, padding: '3px 9px' }} onClick={() => startEdit(h)}>
                          Edit
                        </button>
                        <button
                          className="btn-ghost"
                          style={{ fontSize: 12, padding: '3px 9px', color: 'var(--tint-red-fg)' }}
                          onClick={() => handleDelete(h)}
                          disabled={busy}
                        >
                          Delete
                        </button>
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
