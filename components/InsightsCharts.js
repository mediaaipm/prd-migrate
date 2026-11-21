import { useEffect, useRef, useState } from 'react'

// Hand-drawn SVG charts for Insights (views/projects/[slug]/dashboard.js). Colours come
// from the --chart-* tokens in globals.css (validated for colour-blind separation in
// both themes); text always wears text tokens, never the series colour. Every chart
// has a hover/focus tooltip, and every value it shows is also on the page as text.

const fmtDay = iso => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

function useWidth() {
  const ref = useRef(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

// Clean axis ticks: 0 … a round top at or above max.
function ticks(max, n = 4) {
  if (max <= 0) return [0, 1]
  const raw = max / n
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || raw
  const out = []
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(Math.round(v * 100) / 100)
  if (out[out.length - 1] < max) out.push(Math.round((out[out.length - 1] + step) * 100) / 100)
  return out
}

function Tip({ tip }) {
  if (!tip) return null
  return (
    <div className="chart-tip" style={{ left: tip.x, top: tip.y }} role="status">
      {tip.title && <div className="chart-tip-title">{tip.title}</div>}
      {tip.rows.map(r => (
        <div key={r.label} className="chart-tip-row">
          {r.key && <span className={`chart-key chart-key--${r.key}`} aria-hidden="true" />}
          <strong>{r.value}</strong>
          <span>{r.label}</span>
        </div>
      ))}
    </div>
  )
}

// Sprint burndown: points still open per day (blue) against the straight ideal line.
export function Burndown({ data }) {
  const [ref, w] = useWidth()
  const [hover, setHover] = useState(null)
  const H = 200; const pad = { l: 34, r: 40, t: 12, b: 24 }
  const days = data?.days || []
  const top = ticks(data?.total || 1)
  const yMax = top[top.length - 1] || 1
  const iw = Math.max(1, w - pad.l - pad.r); const ih = H - pad.t - pad.b
  const x = i => pad.l + (days.length > 1 ? (i / (days.length - 1)) * iw : iw / 2)
  const y = v => pad.t + ih - (v / yMax) * ih
  const actual = days.map((d, i) => (d.remaining == null ? null : [x(i), y(d.remaining)])).filter(Boolean)
  const lastIdx = days.reduce((k, d, i) => (d.remaining == null ? k : i), -1)
  const path = pts => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('')

  function move(e) {
    const r = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - r.left
    const i = Math.max(0, Math.min(days.length - 1, Math.round(((px - pad.l) / iw) * (days.length - 1))))
    setHover(i)
  }
  const hd = hover != null ? days[hover] : null
  const tip = hd && {
    x: Math.min(Math.max(x(hover), 70), w - 70), y: 0,
    title: fmtDay(hd.date),
    rows: [
      ...(hd.remaining != null ? [{ key: 'blue', value: `${hd.remaining} pts`, label: 'remaining' }] : []),
      { key: 'ideal', value: `${hd.ideal} pts`, label: 'ideal' },
    ],
  }

  return (
    <div className="chart" ref={ref}>
      {w > 0 && days.length > 0 && (
        <svg width={w} height={H} role="img" aria-label="Sprint burndown: points remaining per day against the ideal line"
          onPointerMove={move} onPointerLeave={() => setHover(null)}>
          {top.map(t => (
            <g key={t}>
              <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} className="chart-grid" />
              <text x={pad.l - 8} y={y(t)} className="chart-axis" textAnchor="end" dominantBaseline="middle">{t}</text>
            </g>
          ))}
          <text x={pad.l} y={H - 6} className="chart-axis">{fmtDay(days[0].date)}</text>
          <text x={w - pad.r} y={H - 6} className="chart-axis" textAnchor="end">{fmtDay(days[days.length - 1].date)}</text>
          <path d={path(days.map((d, i) => [x(i), y(d.ideal)]))} className="chart-ideal" />
          {actual.length > 1 && (
            <path d={`${path(actual)}L${actual[actual.length - 1][0]},${y(0)}L${actual[0][0]},${y(0)}Z`} className="chart-area chart-area--blue" />
          )}
          {actual.length > 0 && <path d={path(actual)} className="chart-line chart-line--blue" />}
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} className="chart-crosshair" />}
          {lastIdx >= 0 && (
            <>
              <circle cx={x(lastIdx)} cy={y(days[lastIdx].remaining)} r="4" className="chart-dot chart-dot--blue" />
              <text x={x(lastIdx) + 8} y={y(days[lastIdx].remaining)} className="chart-label" dominantBaseline="middle">{days[lastIdx].remaining}</text>
            </>
          )}
          <rect x={pad.l} y={pad.t} width={iw} height={ih} fill="transparent" />
        </svg>
      )}
      <Tip tip={tip} />
    </div>
  )
}

// Sprint history: committed (orange) vs done (blue) stories per closed sprint.
export function HistoryColumns({ history }) {
  const [ref, w] = useWidth()
  const [hover, setHover] = useState(null)
  const H = 200; const pad = { l: 30, r: 8, t: 16, b: 28 }
  const top = ticks(Math.max(1, ...history.map(h => Math.max(h.committed + h.added, h.completed))))
  const yMax = top[top.length - 1]
  const iw = Math.max(1, w - pad.l - pad.r); const ih = H - pad.t - pad.b
  const band = iw / Math.max(1, history.length)
  const bw = Math.min(24, Math.max(6, (band - 16) / 2))
  const y = v => pad.t + ih - (v / yMax) * ih
  // 4px rounded data-end, square at the baseline.
  const col = (cx, v) => {
    const h = Math.max(0, y(0) - y(v)); const r = Math.min(4, h, bw / 2)
    if (h <= 0) return ''
    const x0 = cx; const x1 = cx + bw; const yt = y(v); const yb = y(0)
    return `M${x0},${yb}V${yt + r}Q${x0},${yt} ${x0 + r},${yt}H${x1 - r}Q${x1},${yt} ${x1},${yt + r}V${yb}Z`
  }
  const h = hover != null ? history[hover] : null
  const tip = h && {
    x: Math.min(Math.max(pad.l + band * hover + band / 2, 80), w - 80), y: 0,
    title: h.name,
    rows: [
      { key: 'blue', value: h.completed, label: 'stories done' },
      { key: 'orange', value: h.committed + h.added, label: `committed${h.added ? ` (${h.added} added)` : ''}` },
      { value: `${h.completedPoints}/${h.totalPoints}`, label: 'points done' },
      ...(h.carried ? [{ value: h.carried, label: 'carried over' }] : []),
    ],
  }
  return (
    <div className="chart" ref={ref}>
      {w > 0 && (
        <svg width={w} height={H} role="img" aria-label="Stories committed and done per sprint">
          {top.map(t => (
            <g key={t}>
              <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} className="chart-grid" />
              <text x={pad.l - 8} y={y(t)} className="chart-axis" textAnchor="end" dominantBaseline="middle">{t}</text>
            </g>
          ))}
          {history.map((s, i) => {
            const cx = pad.l + band * i + band / 2
            const last = i === history.length - 1
            return (
              <g key={s.id} tabIndex={0} className={`chart-group${hover === i ? ' is-hover' : ''}`}
                onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                aria-label={`${s.name}: ${s.completed} of ${s.committed + s.added} stories done`}>
                <rect x={pad.l + band * i} y={pad.t} width={band} height={ih} fill="transparent" />
                <path d={col(cx - bw - 1, s.committed + s.added)} className="chart-bar chart-bar--orange" />
                <path d={col(cx + 1, s.completed)} className="chart-bar chart-bar--blue" />
                {last && <text x={cx + 1 + bw / 2} y={y(s.completed) - 5} className="chart-label" textAnchor="middle">{s.completed}</text>}
                <text x={cx} y={H - 8} className="chart-axis" textAnchor="middle">
                  {s.name.length > 12 && band < 90 ? `${s.name.slice(0, 10)}…` : s.name}
                </text>
              </g>
            )
          })}
        </svg>
      )}
      <Tip tip={tip} />
    </div>
  )
}

// Tiny trend line for a stat tile: de-emphasised line, current value in the accent.
export function Sparkline({ values, label }) {
  const W = 96; const H = 28
  if (!values || values.length < 2) return null
  const max = Math.max(1, ...values); const min = Math.min(0, ...values)
  const x = i => 2 + (i / (values.length - 1)) * (W - 6)
  const y = v => 3 + (H - 6) - ((v - min) / (max - min || 1)) * (H - 6)
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
  const li = values.length - 1
  return (
    <svg width={W} height={H} className="spark" role="img" aria-label={label}>
      <path d={d} className="spark-line" />
      <circle cx={x(li)} cy={y(values[li])} r="3" className="chart-dot chart-dot--blue" />
    </svg>
  )
}

// One horizontal stacked bar (story pipeline). Segments keep a 2px surface gap; each
// one is its own hover/focus target.
export function StackBar({ parts, total, label }) {
  const [hover, setHover] = useState(null)
  const h = hover != null ? parts[hover] : null
  return (
    <div className="stackbar-wrap">
      <div className="stackbar" role="img" aria-label={label}>
        {parts.map((p, i) => (
          <span
            key={p.key}
            tabIndex={0}
            className={`stackbar-seg${hover === i ? ' is-hover' : ''}`}
            style={{ '--status-color': p.color, flexGrow: p.count }}
            onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}
            onFocus={() => setHover(i)} onBlur={() => setHover(null)}
            aria-label={`${p.label}: ${p.count}`}
          />
        ))}
      </div>
      {h && (
        <div className="chart-tip chart-tip--inline" role="status">
          <div className="chart-tip-row"><strong>{h.count}</strong><span>{h.label} · {Math.round((h.count / Math.max(1, total)) * 100)}%</span></div>
        </div>
      )}
    </div>
  )
}

// Tasks done per week (oldest → this week), one blue column each. Used by Teams.
export function WeeklyBars({ values, label }) {
  const [ref, w] = useWidth()
  const [hover, setHover] = useState(null)
  const H = 150; const pad = { l: 28, r: 8, t: 16, b: 24 }
  const top = ticks(Math.max(1, ...values), 3)
  const yMax = top[top.length - 1]
  const iw = Math.max(1, w - pad.l - pad.r); const ih = H - pad.t - pad.b
  const band = iw / Math.max(1, values.length)
  const bw = Math.min(28, Math.max(6, band - 10))
  const y = v => pad.t + ih - (v / yMax) * ih
  const n = values.length
  const weekLabel = i => (i === n - 1 ? 'This week' : `${n - 1 - i}w ago`)
  const col = (x0, v) => {
    const h = Math.max(0, y(0) - y(v)); const r = Math.min(4, h, bw / 2)
    if (h <= 0) return ''
    const x1 = x0 + bw; const yt = y(v); const yb = y(0)
    return `M${x0},${yb}V${yt + r}Q${x0},${yt} ${x0 + r},${yt}H${x1 - r}Q${x1},${yt} ${x1},${yt + r}V${yb}Z`
  }
  const tip = hover != null && {
    x: Math.min(Math.max(pad.l + band * hover + band / 2, 60), w - 60), y: 0,
    title: weekLabel(hover),
    rows: [{ key: 'blue', value: values[hover], label: 'done' }],
  }
  return (
    <div className="chart" ref={ref}>
      {w > 0 && (
        <svg width={w} height={H} role="img" aria-label={label}>
          {top.map(t => (
            <g key={t}>
              <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} className="chart-grid" />
              <text x={pad.l - 8} y={y(t)} className="chart-axis" textAnchor="end" dominantBaseline="middle">{t}</text>
            </g>
          ))}
          {values.map((v, i) => {
            const cx = pad.l + band * i + band / 2
            return (
              <g key={i} tabIndex={0} className={`chart-group${hover === i ? ' is-hover' : ''}`}
                onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                aria-label={`${weekLabel(i)}: ${v} done`}>
                <rect x={pad.l + band * i} y={pad.t} width={band} height={ih} fill="transparent" />
                <path d={col(cx - bw / 2, v)} className="chart-bar chart-bar--blue" />
                {i === n - 1 && <text x={cx} y={y(v) - 5} className="chart-label" textAnchor="middle">{v}</text>}
                {(i === 0 || i === n - 1) && (
                  <text x={cx} y={H - 6} className="chart-axis" textAnchor={i === 0 ? 'start' : 'end'} dx={i === 0 ? -bw / 2 : bw / 2}>{i === 0 ? `${n - 1}w ago` : 'This week'}</text>
                )}
              </g>
            )
          })}
        </svg>
      )}
      <Tip tip={tip} />
    </div>
  )
}
