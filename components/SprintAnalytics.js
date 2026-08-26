import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { apiFetch } from '../lib/api-fetch'
import { hasPerm, isSuperAdmin } from '../lib/client-permissions'

// ─── guards ───────────────────────────────────────────────────────────────────
// The API is built by another surface and can legitimately answer with a partly
// populated document (a project with no sprints, a sprint with no dates). Every
// read below goes through one of these so a missing field renders a dash instead
// of white-screening the page.

const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0)
const arr = v => (Array.isArray(v) ? v : [])
const int = v => Math.round(num(v))

// ─── dates ────────────────────────────────────────────────────────────────────
// The API speaks 'YYYY-MM-DD'. `new Date('2026-01-26')` parses as midnight UTC but
// every getter reads it back in local time, which shifts the day west of Greenwich.
// Build the date in UTC and format it in UTC so what we print is what was sent.

function parseYmd(s) {
  const m = typeof s === 'string' && /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (!m) return null
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return isNaN(d) ? null : d
}

function fmtDate(s, opts) {
  const d = parseYmd(s)
  if (!d) return '—'
  return d.toLocaleDateString(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric', ...(opts || {}) })
}

function fmtRange(start, end) {
  if (!start && !end) return 'No dates set'
  if (start && end) return `${fmtDate(start)} – ${fmtDate(end)}`
  return start ? `from ${fmtDate(start)}` : `until ${fmtDate(end)}`
}

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function weekendLabel(days) {
  const list = arr(days).map(d => DOW[num(d) % 7]).filter(Boolean)
  if (!list.length) return 'no weekly offs are configured'
  if (list.length === 1) return `${list[0]} is a weekly off`
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]} are weekly offs`
}

function plural(n, one, many) {
  return `${n} ${num(n) === 1 ? one : (many || `${one}s`)}`
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return parts.slice(0, 2).map(p => p[0]).join('').toUpperCase()
}

// Matches the hues the tasks page already uses for the same statuses, so the
// breakdown row reads the same on both screens. Saturated data hues can stay
// literal — the wash and the dark-mode ink lift live in CSS.
const STATUS_COLOR = {
  backlog: '#94a3b8',
  todo: '#3b82f6',
  'in-progress': '#f59e0b',
  'in-review': '#8b5cf6',
  blocked: '#dc2626',
  done: '#16a34a',
}

const HEALTH_LABEL = {
  ahead: 'Ahead of plan',
  'on-track': 'On track',
  'at-risk': 'At risk',
  behind: 'Behind',
  done: 'Complete',
  'not-started': 'Not started',
}

const HEALTH_CHIP = {
  ahead: 'sa-chip--good',
  'on-track': 'sa-chip--good',
  'at-risk': 'sa-chip--warn',
  behind: 'sa-chip--bad',
  done: 'sa-chip--good',
  'not-started': 'sa-chip--info',
}

// The sprint lifecycle, in the order a sprint travels through it. The picker used to
// print the raw slug next to the name ("Sprint 4 · completed"), which said nothing about
// which sprints are live and which are history — these are the words the rest of the app
// already uses on the Tasks page.
const SPRINT_STATUS = {
  active:    { label: 'Active',    group: 'Active',    chip: 'sa-chip--good' },
  planned:   { label: 'Planned',   group: 'Planned',   chip: 'sa-chip--info' },
  completed: { label: 'Completed', group: 'Completed', chip: '' },
}
const SPRINT_STATUS_ORDER = ['active', 'planned', 'completed']

function statusLabel(status) {
  return SPRINT_STATUS[status]?.label || (status ? String(status) : 'Unknown')
}

// Buckets in lifecycle order, empty ones dropped. Anything with a status this build does
// not know about still has to be reachable, so it lands in a trailing bucket rather than
// disappearing from the picker.
function groupSprints(sprints) {
  const buckets = SPRINT_STATUS_ORDER.map(key => ({ key, label: SPRINT_STATUS[key].group, items: [] }))
  const byKey = {}
  buckets.forEach(b => { byKey[b.key] = b })
  const other = { key: 'other', label: 'Other', items: [] }
  for (const s of arr(sprints)) {
    (byKey[s?.status] || other).items.push(s)
  }
  return buckets.concat(other).filter(b => b.items.length)
}

// The group already names the status, so the option carries the dates instead — that is
// what tells two "Sprint 4"s apart.
function sprintOptionLabel(s) {
  const name = s?.name || 'Untitled sprint'
  if (!s?.startDate && !s?.endDate) return name
  return `${name} · ${fmtRange(s.startDate, s.endDate)}`
}

function pctColor(pct) {
  const p = num(pct)
  if (p >= 100) return 'var(--tint-green-fg)'
  if (p >= 60) return 'var(--tint-blue-fg)'
  if (p >= 30) return 'var(--tint-amber-fg)'
  return 'var(--accent)'
}

// ─── small pieces ─────────────────────────────────────────────────────────────

// The custom properties go on the TRACK, not the fill. Both elements read
// --bar-color (the track derives its tinted ground and hairline from it), and custom
// properties only inherit downward — set on the fill, the track would silently fall
// back to --accent and every bar would come out the same colour.
function Bar({ pct, color }) {
  const p = Math.max(0, Math.min(100, num(pct)))
  return (
    <div className="sa-bar" style={{ '--bar-pct': `${p}%`, '--bar-color': color || pctColor(p) }}>
      <div className="sa-bar-fill" />
    </div>
  )
}

function Meter({ pct, color }) {
  const p = Math.max(0, Math.min(100, num(pct)))
  return (
    <div className="sa-meter" title={`${int(p)}%`} style={{ '--bar-pct': `${p}%`, '--bar-color': color || pctColor(p) }}>
      <div className="sa-meter-fill" />
    </div>
  )
}

function Tile({ title, sub, value, label, children }) {
  return (
    <div className="sa-card">
      <div className="sa-card-head">
        <span className="sa-card-title">{title}</span>
        {sub != null && sub !== '' && <span className="sa-card-sub">{sub}</span>}
      </div>
      <div className="sa-card-body">
        <div className="sa-stat">
          <span className="sa-stat-value">{value}</span>
          {label && <span className="sa-stat-label">{label}</span>}
        </div>
        {children}
      </div>
    </div>
  )
}

function Legend({ items }) {
  return (
    <div className="sa-legend">
      {items.map(it => (
        <span key={it.label} className="sa-legend-item">
          <span
            className="sa-legend-swatch"
            style={{
              '--bar-color': it.color,
              // The ideal series is drawn dashed; stripe its swatch so the legend
              // reads the same way the line does.
              ...(it.dashed ? { background: `repeating-linear-gradient(135deg, ${it.color} 0 3px, transparent 3px 5px)` } : null),
            }}
          />
          {it.label}
        </span>
      ))}
    </div>
  )
}

// ─── burndown ─────────────────────────────────────────────────────────────────
// Hand-drawn SVG: no chart library is installed and the app has no bundler budget
// for one. Colours are CSS-variable references so both themes work without a
// second copy of the chart.

const CH = { W: 760, H: 300, l: 46, r: 16, t: 16, b: 34 }

function Burndown({ focus, usesPoints }) {
  const rows = arr(focus?.burndown)
  const unit = usesPoints ? 'points' : 'tasks'

  if (!focus) return <div className="sa-empty">No sprint selected.</div>
  if (!focus.startDate || !focus.endDate || rows.length === 0) {
    return (
      <div className="sa-chart-empty">
        A burndown needs both a start and an end date. Open <strong>Manage</strong> on the sprint
        and set the sprint window — the chart appears as soon as both dates are saved.
      </div>
    )
  }

  const idealKey = usesPoints ? 'idealPoints' : 'idealTasks'
  const remKey = usesPoints ? 'remainingPoints' : 'remainingTasks'

  const n = rows.length
  const plotW = CH.W - CH.l - CH.r
  const plotH = CH.H - CH.t - CH.b
  const x = i => CH.l + (n <= 1 ? plotW / 2 : (i * plotW) / (n - 1))

  let maxY = 1
  for (const r of rows) {
    maxY = Math.max(maxY, num(r[idealKey]))
    if (r[remKey] != null) maxY = Math.max(maxY, num(r[remKey]))
  }
  const y = v => CH.t + (1 - Math.max(0, Math.min(maxY, num(v))) / maxY) * plotH

  // The ideal line spans the whole window; the actual line must stop at today, so
  // future rows (which carry a null remaining value) are dropped rather than
  // drawn as a dive to zero.
  const idealPath = rows.map((r, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(r[idealKey]).toFixed(1)}`).join(' ')
  const actual = []
  rows.forEach((r, i) => {
    if (r.isFuture || r[remKey] == null) return
    actual.push({ x: x(i), y: y(r[remKey]) })
  })
  const actualPath = actual.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const head = actual[actual.length - 1] || null

  let todayIdx = -1
  rows.forEach((r, i) => { if (!r.isFuture) todayIdx = i })

  const colW = n > 1 ? plotW / (n - 1) : plotW
  const bandX = i => Math.max(CH.l, x(i) - colW / 2)
  const bandW = i => Math.min(CH.l + plotW, x(i) + colW / 2) - bandX(i)

  const step = Math.max(4, Math.ceil(n / 8))
  const gridFracs = [0, 0.25, 0.5, 0.75, 1]

  return (
    <div className="sa-chart">
      <svg
        className="sa-chart-svg"
        viewBox={`0 0 ${CH.W} ${CH.H}`}
        width="100%"
        role="img"
        aria-label={`Burndown of remaining ${unit} against the ideal line`}
      >
        {/* Non-working days, so the flat stretches in the ideal line are explained
            rather than looking like a stalled sprint. */}
        {rows.map((r, i) => {
          if (!r.isWeekend && !r.isHoliday) return null
          return (
            <rect
              key={`band-${r.date || i}`}
              x={bandX(i)}
              y={CH.t}
              width={Math.max(0, bandW(i))}
              height={plotH}
              fill={r.isHoliday ? 'var(--tint-amber-bg)' : 'var(--surface-2)'}
              opacity={r.isHoliday ? 0.9 : 0.7}
            >
              {/* An optional holiday still counts as a working day, so it never
                  gets a holiday band — but its name still belongs in the tooltip
                  when it lands on a weekend. */}
              <title>
                {r.isHoliday
                  ? `${r.holidayName || 'Holiday'} — ${fmtDate(r.date)}`
                  : `Weekend — ${fmtDate(r.date)}${r.holidayName ? ` (${r.holidayName})` : ''}`}
              </title>
            </rect>
          )
        })}

        {gridFracs.map(f => (
          <g key={`grid-${f}`}>
            <line x1={CH.l} x2={CH.l + plotW} y1={y(maxY * f)} y2={y(maxY * f)} stroke="var(--border)" strokeWidth="1" />
            <text x={CH.l - 8} y={y(maxY * f) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">
              {Math.round(maxY * f)}
            </text>
          </g>
        ))}

        {rows.map((r, i) => {
          if (i % step !== 0 && i !== n - 1) return null
          return (
            <text key={`ax-${r.date || i}`} x={x(i)} y={CH.H - 12} textAnchor="middle" fontSize="11" fill="var(--muted)">
              {r.label || fmtDate(r.date)}
            </text>
          )
        })}

        <path d={idealPath} fill="none" stroke="var(--tint-gray-fg)" strokeWidth="2" strokeDasharray="6 5" strokeLinejoin="round" />
        {actual.length > 1 && (
          <path d={actualPath} fill="none" stroke="var(--tint-indigo-fg)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        )}

        {todayIdx >= 0 && (
          <g>
            <line x1={x(todayIdx)} x2={x(todayIdx)} y1={CH.t} y2={CH.t + plotH} stroke="var(--tint-red-fg)" strokeWidth="1.5" strokeDasharray="3 4" />
            <text x={x(todayIdx)} y={CH.t - 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--tint-red-fg)">Today</text>
          </g>
        )}
        {/* The head of the actual line — also the only mark when a sprint is one
            day old and there is nothing to draw a line between. */}
        {head && <circle cx={head.x} cy={head.y} r="4" fill="var(--tint-indigo-fg)" stroke="var(--surface)" strokeWidth="1.5" />}
      </svg>

      <Legend
        items={[
          { label: `Ideal ${unit} remaining`, color: 'var(--tint-gray-fg)', dashed: true },
          { label: `Actual ${unit} remaining`, color: 'var(--tint-indigo-fg)' },
          { label: 'Weekend', color: 'var(--surface-2)' },
          { label: 'Holiday', color: 'var(--tint-amber-bg)' },
        ]}
      />
      <p className="sa-note">
        The ideal line only descends on working days, which is why it flattens across shaded
        bands. Hover a shaded band to see which day it is.
      </p>
    </div>
  )
}

// ─── velocity ─────────────────────────────────────────────────────────────────

function Velocity({ velocity, usesPoints }) {
  const history = arr(velocity?.history)
  const unit = usesPoints ? 'points' : 'tasks'
  const valueOf = h => (usesPoints ? num(h?.donePoints) : num(h?.doneTasks))

  if (history.length < 1) {
    return (
      <div className="sa-empty">
        No velocity yet. A sprint contributes to velocity once it is marked
        <strong> completed</strong> — finish a sprint and its throughput shows up here.
      </div>
    )
  }

  const max = Math.max(1, ...history.map(valueOf))
  const avg = usesPoints ? num(velocity.averagePoints) : num(velocity.averageTasks)
  const avgPct = Math.max(0, Math.min(100, (avg / max) * 100))
  const trend = ['up', 'down', 'flat'].includes(velocity?.trend) ? velocity.trend : 'flat'
  const trendArrow = trend === 'up' ? '▲' : trend === 'down' ? '▼' : '▬'

  return (
    <>
      <div className="sa-velocity">
        <div className="sa-velocity-bar">
          {avg > 0 && (
            <div
              className="sa-velocity-avg"
              style={{ '--bar-pct': `${avgPct}%` }}
              title={`Average ${avg} ${unit} per sprint`}
            >
              avg {avg}
            </div>
          )}
          {history.map((h, i) => {
            const v = valueOf(h)
            const pct = Math.max(v > 0 ? 3 : 0, (v / max) * 100)
            return (
              <div className="sa-velocity-col" key={h?.sprintId || `vel-${i}`} title={`${h?.name || 'Sprint'} · ${v} ${unit} · ended ${fmtDate(h?.endDate)}`}>
                <span className="sa-velocity-value">{v}</span>
                <div
                  className="sa-velocity-fill"
                  style={{ '--bar-pct': `${pct}%`, '--bar-color': 'var(--tint-indigo-fg)' }}
                />
                <span className="sa-velocity-label">{h?.name || '—'}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="sa-grid">
        <Tile title={`Average ${unit}`} value={avg} label="per completed sprint" />
        <Tile title={`Median ${unit}`} value={num(velocity.medianPoints)} label="half above, half below" />
        <Tile title="Last sprint" value={num(velocity.lastPoints)} label={`${unit} delivered`}>
          <span className={`sa-stat-delta ${trend}`}>{trendArrow} {trend === 'flat' ? 'holding steady' : trend === 'up' ? 'trending up' : 'trending down'}</span>
        </Tile>
        <Tile
          title="Forecast"
          value={usesPoints ? num(velocity.forecastPoints) : num(velocity.forecastTasks)}
          label="expected next sprint"
          sub="rolling avg of 3"
        />
      </div>

      <div className="sa-table-scroll">
        <table className="sa-table">
          <thead>
            <tr>
              <th>Sprint</th>
              <th>Ended</th>
              <th className="sa-table-num">Done</th>
              <th className="sa-table-num">Planned</th>
              <th className="sa-table-num">Capacity</th>
              <th className="sa-table-num">Working days</th>
              <th className="sa-table-num">Per day</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h, i) => (
              <tr key={h?.sprintId || `row-${i}`}>
                <td>{h?.name || '—'}</td>
                <td>{fmtDate(h?.endDate)}</td>
                <td className="sa-table-num">{usesPoints ? num(h?.donePoints) : num(h?.doneTasks)}</td>
                <td className="sa-table-num">{usesPoints ? num(h?.plannedPoints) : num(h?.plannedTasks)}</td>
                <td className="sa-table-num">{h?.capacityPoints == null ? '—' : num(h.capacityPoints)}</td>
                <td className="sa-table-num">{num(h?.workingDays)}</td>
                <td className="sa-table-num">{h?.pointsPerWorkingDay == null ? '—' : num(h.pointsPerWorkingDay)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="sa-note">Oldest sprint first. Only completed sprints count toward velocity.</p>
    </>
  )
}

// ─── team ─────────────────────────────────────────────────────────────────────

function teamColumns(usesPoints, showSprints) {
  const unit = usesPoints ? 'pts' : 'tasks'
  const cols = [
    { key: 'name', label: 'Member', numeric: false },
    { key: 'assignedTasks', label: 'Assigned', numeric: true },
    { key: 'doneTasks', label: 'Done', numeric: true },
    { key: 'inProgressTasks', label: 'In progress', numeric: true },
    { key: 'blockedTasks', label: 'Blocked', numeric: true },
    { key: 'overdueTasks', label: 'Overdue', numeric: true },
    { key: 'donePoints', label: `Done ${unit}`, numeric: true },
    { key: 'completionRate', label: 'Completion', numeric: true },
    { key: 'onTimeRate', label: 'On time', numeric: true },
    { key: 'avgCycleTimeDays', label: 'Cycle time', numeric: true },
    { key: 'throughputPerWorkingDay', label: 'Throughput', numeric: true },
  ]
  if (showSprints) cols.push({ key: 'sprintsParticipated', label: 'Sprints', numeric: true })
  return cols
}

function TeamTable({ rows, usesPoints, showSprints }) {
  const [sort, setSort] = useState({ key: 'donePoints', dir: 'desc' })
  const cols = teamColumns(usesPoints, showSprints)

  const sorted = useMemo(() => {
    const list = arr(rows).slice()
    const { key, dir } = sort
    const mul = dir === 'asc' ? 1 : -1
    list.sort((a, b) => {
      if (key === 'name') return mul * String(a?.name || '').localeCompare(String(b?.name || ''))
      // A null cycle time means "never measured"; keep those at the bottom in
      // either direction rather than letting 0 outrank a real reading.
      const av = a?.[key] == null ? -Infinity : num(a[key])
      const bv = b?.[key] == null ? -Infinity : num(b[key])
      return mul * (av - bv)
    })
    return list
  }, [rows, sort])

  function toggle(key) {
    setSort(s => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' ? 'asc' : 'desc' }))
  }

  if (!sorted.length) {
    return <div className="sa-empty">Nobody is assigned to a task in this scope yet. Assign a task and the breakdown appears here.</div>
  }

  return (
    <div className="sa-table-scroll">
      <table className="sa-table">
        <thead>
          <tr>
            {cols.map(c => (
              <th
                key={c.key}
                className={c.numeric ? 'sa-table-num' : undefined}
                onClick={() => toggle(c.key)}
                title={`Sort by ${c.label}`}
                aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                style={{ cursor: 'pointer', userSelect: 'none' }}
              >
                {c.label}{sort.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((m, i) => (
            <tr key={m?.name || `member-${i}`}>
              <td>
                <span className="sa-member">
                  <span className="sa-avatar">{initials(m?.name)}</span>
                  <span className="sa-member-name">{m?.name || 'Unknown'}</span>
                </span>
              </td>
              <td className="sa-table-num">{num(m?.assignedTasks)}</td>
              <td className="sa-table-num">{num(m?.doneTasks)}</td>
              <td className="sa-table-num">{num(m?.inProgressTasks)}</td>
              <td className="sa-table-num">{num(m?.blockedTasks)}</td>
              <td className="sa-table-num">{num(m?.overdueTasks)}</td>
              <td className="sa-table-num">{num(m?.donePoints)}</td>
              <td className="sa-table-num">
                <Meter pct={m?.completionRate} />
                {int(m?.completionRate)}%
              </td>
              <td className="sa-table-num">{int(m?.onTimeRate)}%</td>
              <td className="sa-table-num">{m?.avgCycleTimeDays == null ? '—' : `${num(m.avgCycleTimeDays)}d`}</td>
              <td className="sa-table-num">{m?.throughputPerWorkingDay == null ? '—' : num(m.throughputPerWorkingDay)}</td>
              {showSprints && <td className="sa-table-num">{num(m?.sprintsParticipated)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── holidays ─────────────────────────────────────────────────────────────────

function Holidays({ data, currentUser }) {
  const focusHolidays = arr(data?.focus?.holidays)
  const upcoming = arr(data?.upcomingHolidays)
  const canManage = isSuperAdmin(currentUser) || hasPerm(currentUser, 'holiday:manage')

  return (
    <>
      <div className="sa-card">
        <div className="sa-card-head">
          <span className="sa-card-title">In this sprint</span>
          <span className="sa-card-sub">{plural(focusHolidays.length, 'holiday')}</span>
        </div>
        <div className="sa-card-body">
          {focusHolidays.length === 0 ? (
            <div className="sa-empty">No holidays fall inside this sprint window.</div>
          ) : (
            <div className="sa-holidays">
              {focusHolidays.map((h, i) => (
                <div className="sa-holiday-row" key={`${h?.date || i}-focus`}>
                  <span className="sa-holiday-date">{fmtDate(h?.date, { weekday: 'short' })}</span>
                  <span className="sa-holiday-name">{h?.name || 'Holiday'}</span>
                  <span className="sa-holiday-type">{h?.type || 'public'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="sa-card">
        <div className="sa-card-head">
          <span className="sa-card-title">Next 60 days</span>
          <span className="sa-card-sub">{plural(upcoming.length, 'holiday')}</span>
        </div>
        <div className="sa-card-body">
          {upcoming.length === 0 ? (
            <div className="sa-empty">No holidays in the next 60 days.</div>
          ) : (
            <div className="sa-holidays">
              {upcoming.map((h, i) => (
                <div className="sa-holiday-row" key={`${h?.date || i}-up`}>
                  <span className="sa-holiday-date">{fmtDate(h?.date, { weekday: 'short', year: 'numeric' })}</span>
                  <span className="sa-holiday-name">{h?.name || 'Holiday'}</span>
                  <span className="sa-holiday-type">{h?.type || 'public'}</span>
                  <span className="sa-chip sa-chip--info">
                    {num(h?.daysAway) === 0 ? 'today' : `in ${plural(num(h?.daysAway), 'day')}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="sa-note">
        Working days exclude weekly offs and holidays — currently {weekendLabel(data?.config?.weekendDays)}.
        Optional holidays still count as working days.
      </p>
      {canManage && (
        <p className="sa-note">
          Manage the holiday calendar in <Link href="/admin">Admin → Holidays</Link>.
        </p>
      )}
    </>
  )
}

// ─── overview ─────────────────────────────────────────────────────────────────

function healthSentence(focus) {
  if (!focus) return ''
  const delta = int(num(focus.pct) - num(focus.expectedPct))
  const left = num(focus.workingDaysLeft)
  const daysPart = focus.endDate ? `${plural(left, 'working day')} left` : 'no end date set'

  if (focus.health === 'done') return 'Sprint complete — every task in scope is done.'
  if (focus.health === 'not-started') {
    return focus.startDate ? `Not started yet — the window opens ${fmtDate(focus.startDate)}.` : 'Not started yet — no start date is set.'
  }
  if (delta >= 3) return `${delta}% ahead of the ideal line, ${daysPart}.`
  if (delta <= -3) return `${Math.abs(delta)}% behind the ideal line, ${daysPart}.`
  return `Tracking within ${Math.abs(delta)}% of the ideal line, ${daysPart} — ${plural(num(focus.openTasks), 'task')} still open.`
}

function Overview({ focus, usesPoints, compact }) {
  const unit = usesPoints ? 'points' : 'tasks'
  const health = HEALTH_LABEL[focus?.health] ? focus.health : 'not-started'
  const byStatus = focus?.byStatus && typeof focus.byStatus === 'object' ? focus.byStatus : {}
  const scope = focus?.scopeChange && typeof focus.scopeChange === 'object' ? focus.scopeChange : { added: 0, removed: 0 }

  return (
    <>
      {focus?.goal && (
        <div className="sa-card">
          <div className="sa-card-head">
            <span className="sa-card-title">Sprint goal</span>
            <span className="sa-card-sub">{fmtRange(focus.startDate, focus.endDate)}</span>
          </div>
          <div className="sa-card-body">{focus.goal}</div>
        </div>
      )}

      {/* .sa-health is a nowrap pill, so the plain-English reading sits beside it
          in the card body rather than inside the badge. */}
      <div className="sa-card">
        <div className="sa-card-head">
          <span className="sa-card-title">{focus?.name || 'Sprint'} health</span>
          <span className={`sa-health ${health}`}>{HEALTH_LABEL[health]}</span>
        </div>
        <div className="sa-card-body">{healthSentence(focus)}</div>
      </div>

      <div className="sa-grid">
        <Tile title="Completion" sub={`${int(focus?.pct)}%`} value={`${num(focus?.doneTasks)}/${num(focus?.totalTasks)}`} label="tasks done">
          <Bar pct={focus?.pct} />
          <span className="sa-stat-label">Ideal by now: {int(focus?.expectedPct)}%</span>
        </Tile>

        <Tile title={usesPoints ? 'Points' : 'Weighted items'} sub={`${int(focus?.pointsPct)}%`} value={`${num(focus?.donePoints)}/${num(focus?.totalPoints)}`} label={`${unit} done`}>
          <Bar pct={focus?.pointsPct} color="var(--tint-indigo-fg)" />
          {focus?.capacityPoints != null && (
            <span className="sa-stat-label">Planned capacity: {num(focus.capacityPoints)} {unit}</span>
          )}
        </Tile>

        <Tile
          title="Working days"
          sub={focus?.endDate ? fmtDate(focus.endDate) : 'open-ended'}
          value={focus?.endDate ? num(focus?.workingDaysLeft) : '—'}
          label="left"
        >
          <span className="sa-stat-label">
            {num(focus?.workingDaysElapsed)} of {num(focus?.workingDays)} elapsed
            {focus?.calendarDaysLeft != null && ` · ${plural(num(focus.calendarDaysLeft), 'calendar day')} left`}
          </span>
        </Tile>

        <Tile
          title="Needed per day"
          sub={unit}
          value={focus?.requiredPerDay == null ? '—' : num(focus.requiredPerDay)}
          label={focus?.requiredPerDay == null ? 'set an end date to project this' : `${unit} per working day to finish`}
        />

        {!compact && (
          <Tile
            title="Scope change"
            sub="vs the plan"
            value={`+${num(scope.added)} / −${num(scope.removed)}`}
            label={num(scope.added) === 0 && num(scope.removed) === 0 ? 'scope is unchanged' : 'tasks added / removed since start'}
          />
        )}

        <Tile title="Overdue" value={num(focus?.overdueTasks)} label="past their due date" />
        {!compact && <Tile title="Blocked" value={num(focus?.blockedTasks)} label="waiting on something" />}
        {!compact && <Tile title="Unassigned" value={num(focus?.unassignedTasks)} label="nobody owns these yet" />}
      </div>

      {Object.keys(byStatus).length > 0 && (
        <div className="sa-card">
          <div className="sa-card-head">
            <span className="sa-card-title">By status</span>
            <span className="sa-card-sub">{plural(num(focus?.totalTasks), 'task')} in sprint</span>
          </div>
          <div className="sa-card-body">
            {/* Same wrapping chip row the tasks page uses for these statuses. */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {Object.entries(byStatus)
                .sort((a, b) => num(b[1]) - num(a[1]))
                .map(([status, count]) => (
                  <span key={status} className="status-count-chip" style={{ '--status-color': STATUS_COLOR[status] || '#64748b' }}>
                    <span className="status-count-dot" />
                    {status}
                    <span style={{ fontWeight: 800 }}>{num(count)}</span>
                  </span>
                ))}
            </div>
          </div>
        </div>
      )}

      {!compact && arr(focus?.holidays).length > 0 && (
        <p className="sa-note">
          {plural(arr(focus.holidays).length, 'holiday')} inside this window
          ({arr(focus.holidays).slice(0, 3).map(h => h?.name).filter(Boolean).join(', ')}
          {arr(focus.holidays).length > 3 ? '…' : ''}) plus {num(focus?.weekendDaysInWindow)} weekend days
          are already excluded from the working-day counts above.
        </p>
      )}

      {!compact && (
        <p className="sa-note">
          Figures are counted in {unit}.
          {usesPoints
            ? ' Tasks without an explicit estimate count as 1 point.'
            : ' No task in this project carries story points, so every task counts as one unit.'}
        </p>
      )}
    </>
  )
}

// ─── shell ────────────────────────────────────────────────────────────────────

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'burndown', label: 'Burndown' },
  { key: 'velocity', label: 'Velocity' },
  { key: 'team', label: 'Team' },
  { key: 'holidays', label: 'Holidays' },
]

export default function SprintAnalytics({ slug, currentUser, sprintId, onSprintChange, embedded }) {
  const [selected, setSelected] = useState(sprintId || null)
  const [tab, setTab] = useState('overview')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const [showAllTime, setShowAllTime] = useState(false)

  // The URL is the source of truth when the page drives the picker; `selected`
  // keeps the component usable on its own (embedded, or without a router).
  useEffect(() => { setSelected(sprintId || null) }, [sprintId])

  useEffect(() => {
    if (!slug) return undefined
    let alive = true
    setLoading(true)
    setError(null)
    const q = selected ? `?sprintId=${encodeURIComponent(selected)}` : ''
    apiFetch(`/api/projects/${slug}/sprint-analytics${q}`)
      .then(r => {
        if (r.ok) return r.json()
        if (r.status === 403) throw new Error('You do not have permission to view sprint analytics for this project.')
        if (r.status === 404) throw new Error('This project has no sprint analytics yet.')
        throw new Error(`Could not load sprint analytics (${r.status}).`)
      })
      .then(d => {
        if (!alive) return
        setData(d && typeof d === 'object' ? d : null)
        setLoading(false)
      })
      .catch(e => {
        if (!alive) return
        setError(e?.message || 'Could not load sprint analytics.')
        setLoading(false)
      })
    return () => { alive = false }
  }, [slug, selected, attempt])

  function pickSprint(id) {
    const next = id || null
    setSelected(next)
    onSprintChange?.(next)
  }

  if (loading) {
    return (
      <div className="sprint-analytics">
        <div className="sa-toolbar">
          <span className="sa-skeleton" style={{ width: 220, height: 32 }} />
          <span className="sa-skeleton" style={{ width: 320, height: 32 }} />
        </div>
        <div className="sa-grid">
          {[0, 1, 2, 3, 4, 5].map(i => <span key={i} className="sa-skeleton" style={{ height: 88, borderRadius: 10 }} />)}
        </div>
        <span className="sa-skeleton" style={{ height: 240, borderRadius: 10 }} />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="sprint-analytics">
        <div className="sa-empty">
          <p>{error || 'Sprint analytics is unavailable right now.'}</p>
          <button type="button" className="btn-ghost" onClick={() => setAttempt(a => a + 1)}>Retry</button>
        </div>
      </div>
    )
  }

  const sprints = arr(data.sprints)
  const focus = data.focus || null
  const usesPoints = !!data.usesPoints
  const currentId = selected || data.focusSprintId || ''

  if (!focus && sprints.length === 0) {
    return (
      <div className="sprint-analytics">
        <div className="sa-empty">
          <p>No sprints in this project yet. Create one on the Tasks page and its burndown, velocity and team breakdown appear here.</p>
          <Link href={`/projects/${slug}/tasks`} className="btn-ghost">Go to Tasks</Link>
        </div>
      </div>
    )
  }

  if (embedded) {
    return (
      <div className="sprint-analytics">
        <div className="sa-toolbar">
          <span className="sa-card-title">{focus?.name || 'Sprint'}</span>
          <Link href={`/projects/${slug}/sprints${currentId ? `?sprint=${encodeURIComponent(currentId)}` : ''}`} className="btn-ghost">
            Full analytics →
          </Link>
        </div>
        <Overview focus={focus} usesPoints={usesPoints} compact />
      </div>
    )
  }

  return (
    <div className="sprint-analytics">
      <div className="sa-toolbar">
        {/* .sa-toolbar is space-between, so the picker and its chips travel as one
            group and the tab strip stays pinned to the other end. */}
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, minWidth: 0 }}>
          <select
            className="form-input"
            value={currentId}
            onChange={e => pickSprint(e.target.value)}
            aria-label="Choose a sprint"
            style={{ width: 'auto', minWidth: 180 }}
          >
            {/* A ?sprint= id that no longer exists must not leave the select blank. */}
            {!sprints.some(s => s?.id === currentId) && <option value={currentId}>Select a sprint…</option>}
            {groupSprints(sprints).map(g => (
              <optgroup key={g.key} label={`${g.label} (${g.items.length})`}>
                {g.items.map((s, i) => (
                  <option key={s?.id || `${g.key}-${i}`} value={s?.id || ''}>
                    {sprintOptionLabel(s)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {focus?.status && (
            <span className={`sa-chip ${SPRINT_STATUS[focus.status]?.chip || ''}`}>
              <span className="sa-chip-dot" />{statusLabel(focus.status)}
            </span>
          )}
          {focus && <span className="sa-chip sa-chip--info"><span className="sa-chip-dot" />{fmtRange(focus.startDate, focus.endDate)}</span>}
          {focus?.health && (
            <span className={`sa-chip ${HEALTH_CHIP[focus.health] || 'sa-chip--info'}`}>
              <span className="sa-chip-dot" />{HEALTH_LABEL[focus.health] || focus.health}
            </span>
          )}
        </div>
        <div className="sa-tabs">
          {TABS.map(t => (
            <button
              key={t.key}
              type="button"
              className={`sa-tab${tab === t.key ? ' active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* The optgroup counts are only readable while the dropdown is open, so the same
          breakdown sits in the open as a jump-list: one chip per status, selecting the
          newest sprint in that bucket. */}
      {sprints.length > 1 && (
        <div className="sa-status-rail">
          {groupSprints(sprints).map(g => {
            const on = g.items.some(s => s?.id === currentId)
            const target = g.items.find(s => s?.id)
            return (
              <button
                key={g.key}
                type="button"
                className={`sa-chip sa-status-pill${on ? ' is-on' : ''} ${SPRINT_STATUS[g.key]?.chip || ''}`}
                onClick={() => target && pickSprint(target.id)}
                disabled={!target}
                title={`Newest ${g.label.toLowerCase()} sprint: ${target ? sprintOptionLabel(target) : '—'}`}
              >
                <span className="sa-chip-dot" />{g.label} · {g.items.length}
              </button>
            )
          })}
        </div>
      )}

      {!focus ? (
        <div className="sa-empty">Pick a sprint above to see its analytics.</div>
      ) : tab === 'overview' ? (
        <Overview focus={focus} usesPoints={usesPoints} />
      ) : tab === 'burndown' ? (
        <Burndown focus={focus} usesPoints={usesPoints} />
      ) : tab === 'velocity' ? (
        <Velocity velocity={data.velocity} usesPoints={usesPoints} />
      ) : tab === 'team' ? (
        <>
          <div className="sa-card">
            <div className="sa-card-head">
              <span className="sa-card-title">{focus.name || 'This sprint'}</span>
              <span className="sa-card-sub">{plural(arr(data.team).length, 'member')}</span>
            </div>
            <div className="sa-card-body">
              <TeamTable rows={data.team} usesPoints={usesPoints} />
            </div>
          </div>

          <p className="sa-note">
            A task with several assignees counts in full for each of them, so these columns
            deliberately add up to more than the sprint total.
          </p>

          <button type="button" className="btn-ghost" onClick={() => setShowAllTime(v => !v)}>
            {showAllTime ? '▾' : '▸'} All sprints ({arr(data.teamAllTime).length})
          </button>
          {showAllTime && (
            <div className="sa-card">
              <div className="sa-card-head">
                <span className="sa-card-title">Across every sprint</span>
                <span className="sa-card-sub">whole project</span>
              </div>
              <div className="sa-card-body">
                <TeamTable rows={data.teamAllTime} usesPoints={usesPoints} showSprints />
              </div>
            </div>
          )}
        </>
      ) : (
        <Holidays data={data} currentUser={currentUser} />
      )}
    </div>
  )
}
