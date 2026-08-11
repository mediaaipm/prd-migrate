import { useState, useEffect } from 'react'
import Link from 'next/link'
import Nav from '../components/Nav'

const ACTION_LABELS = {
  login: 'Logged in', logout: 'Logged out', login_failed: 'Login failed',
  view_project: 'Viewed project', create_project: 'Created project', delete_project: 'Deleted project',
  view_version: 'Viewed version', create_version: 'Created version', save_version: 'Saved version',
  view_diff: 'Viewed diff',
  create_proposal: 'Created proposal', update_proposal: 'Updated proposal',
  delete_proposal: 'Deleted proposal', promote_proposal: 'Promoted proposal',
  create_task: 'Created task', update_task: 'Updated task', delete_task: 'Deleted task',
  reorder_task: 'Reordered task',
}

const STALE_DAYS = 14

function timeAgo(ts) {
  if (!ts) return '—'
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(ts).toLocaleDateString()
}

function formatDate(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// ─── Stat card ───────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, color, sub }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: '18px 20px',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      boxShadow: '0 1px 4px rgba(0,0,0,.06)',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', top: 0, left: 0, width: 4,
        height: '100%', background: color, borderRadius: '12px 0 0 12px',
      }} />
      <div style={{ fontSize: 20, lineHeight: 1 }}>{icon}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Panel({ title, count, countColor, accent, children }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      overflow: 'hidden',
      boxShadow: '0 1px 4px rgba(0,0,0,.06)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '14px 20px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg)',
        borderLeft: accent ? `4px solid ${accent}` : undefined,
      }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{title}</span>
        {count !== undefined && (
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
            background: countColor || 'var(--border)',
            color: countColor ? 'var(--on-accent)' : 'var(--muted)',
          }}>
            {count}
          </span>
        )}
      </div>
      <div style={{ padding: '16px 20px' }}>{children}</div>
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function Empty({ icon, message }) {
  return (
    <div style={{
      padding: '28px 16px', textAlign: 'center',
      color: 'var(--muted)', fontSize: 13,
      border: '1px dashed var(--border)', borderRadius: 8,
    }}>
      <div style={{ fontSize: 24, marginBottom: 8 }}>{icon}</div>
      {message}
    </div>
  )
}

// ─── Status / type badges ─────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const map = {
    todo:        { bg: 'var(--tint-slate-bg)',  color: 'var(--tint-slate-fg)' },
    'in-progress': { bg: 'var(--tint-blue-bg)', color: 'var(--tint-blue-fg)' },
    'in-review': { bg: 'var(--tint-violet-bg)', color: 'var(--tint-violet-fg)' },
    review:      { bg: 'var(--tint-amber-bg)',  color: 'var(--tint-amber-fg)' },
    blocked:     { bg: 'var(--tint-red-bg)',    color: 'var(--tint-red-fg)' },
    done:        { bg: 'var(--tint-green-bg)',  color: 'var(--tint-green-fg)' },
    pending:     { bg: 'var(--tint-yellow-bg)', color: 'var(--tint-yellow-fg)' },
    promoted:    { bg: 'var(--tint-green-bg)',  color: 'var(--tint-green-fg)' },
  }
  const s = map[status] || { bg: 'var(--tint-slate-bg)', color: 'var(--tint-slate-fg)' }
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
      background: s.bg, color: s.color, whiteSpace: 'nowrap',
    }}>
      {status}
    </span>
  )
}

function TypeBadge({ type }) {
  const isTask = type === 'task'
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
      background: isTask ? 'rgba(124,58,237,.1)' : 'rgba(59,130,246,.1)',
      color: isTask ? 'var(--tint-violet-fg)' : 'var(--tint-blue-fg)', whiteSpace: 'nowrap',
    }}>
      {isTask ? 'Task' : 'Proposal'}
    </span>
  )
}

function CountdownBadge({ daysUntil }) {
  const urgent = daysUntil <= 1
  const soon   = daysUntil <= 3
  const bg    = urgent ? 'var(--tint-red-bg)' : soon ? 'var(--tint-amber-bg)' : 'var(--tint-green-bg)'
  const color = urgent ? 'var(--tint-red-fg)' : soon ? 'var(--tint-amber-fg)' : 'var(--tint-green-fg)'
  const label = daysUntil === 0 ? 'Today' : daysUntil === 1 ? 'Tomorrow' : `${daysUntil}d`
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 20,
      background: bg, color, border: `1px solid color-mix(in srgb, ${color} 35%, transparent)`, whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  )
}

// ─── Compact data table ───────────────────────────────────────────────────────

function DataTable({ cols, rows, emptyIcon, emptyMsg }) {
  if (rows.length === 0) return <Empty icon={emptyIcon} message={emptyMsg} />
  return (
    <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid var(--border)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            {cols.map(c => (
              <th key={c.key} style={{
                padding: '8px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600,
                textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)',
                background: 'var(--bg)', borderBottom: '1px solid var(--border)',
                whiteSpace: 'nowrap', width: c.w,
              }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{
              borderBottom: i < rows.length - 1 ? '1px solid var(--border)' : 'none',
              background: 'var(--surface)',
              transition: 'background .1s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}
            >
              {cols.map(c => (
                <td key={c.key} style={{ padding: '10px 14px', verticalAlign: 'middle' }}>
                  {row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Horizontal bar ───────────────────────────────────────────────────────────

function HBar({ pct, color, height = 12 }) {
  return (
    <div style={{
      height, background: 'var(--border)', borderRadius: height,
      overflow: 'hidden', flex: 1,
    }}>
      <div style={{
        height: '100%', width: `${pct}%`, background: color,
        borderRadius: height, transition: 'width .4s cubic-bezier(.4,0,.2,1)',
        minWidth: pct > 0 ? 6 : 0,
      }} />
    </div>
  )
}

// ─── Panels ───────────────────────────────────────────────────────────────────

function OverduePanel({ items }) {
  const cols = [
    { key: 'title',    label: 'Title' },
    { key: 'type',     label: 'Type',     w: 90 },
    { key: 'project',  label: 'Project',  w: 120 },
    { key: 'dueDate',  label: 'Due',      w: 110 },
    { key: 'overdue',  label: 'Overdue',  w: 80 },
    { key: 'assignees',label: 'Assignee', w: 120 },
    { key: 'status',   label: 'Status',   w: 100 },
  ]
  const rows = items.map(item => ({
    title:     <Link href={item.type === 'task' ? `/projects/${item.slug}/tasks` : `/projects/${item.slug}`} style={{ fontWeight: 500, color: 'var(--accent)' }}>{item.title}</Link>,
    type:      <TypeBadge type={item.type} />,
    project:   <span style={{ color: 'var(--muted)' }}>{item.project}</span>,
    dueDate:   <span style={{ color: 'var(--tint-red-fg)', fontWeight: 500 }}>{formatDate(item.dueDate)}</span>,
    overdue:   <span style={{ fontWeight: 800, color: 'var(--tint-red-fg)', fontSize: 13 }}>{item.daysOverdue}d</span>,
    assignees: item.assignees?.length > 0
      ? <span style={{ color: 'var(--muted)' }}>{item.assignees.join(', ')}</span>
      : <span style={{ color: 'var(--tint-amber-fg)', fontWeight: 600, fontSize: 11 }}>Unassigned</span>,
    status:    <StatusBadge status={item.status} />,
  }))
  return (
    <Panel title="Overdue Items" count={items.length} countColor={items.length > 0 ? 'var(--tint-red-fg)' : undefined} accent="var(--tint-red-fg)">
      <DataTable cols={cols} rows={rows} emptyIcon="✅" emptyMsg="Nothing overdue — all items are on track." />
    </Panel>
  )
}

function UpcomingPanel({ items }) {
  const cols = [
    { key: 'title',    label: 'Title' },
    { key: 'type',     label: 'Type',     w: 90 },
    { key: 'project',  label: 'Project',  w: 120 },
    { key: 'dueDate',  label: 'Due',      w: 110 },
    { key: 'dueIn',    label: 'Due In',   w: 90 },
    { key: 'assignees',label: 'Assignee', w: 120 },
    { key: 'status',   label: 'Status',   w: 100 },
  ]
  const rows = items.map(item => ({
    title:     <Link href={item.type === 'task' ? `/projects/${item.slug}/tasks` : `/projects/${item.slug}`} style={{ fontWeight: 500, color: 'var(--accent)' }}>{item.title}</Link>,
    type:      <TypeBadge type={item.type} />,
    project:   <span style={{ color: 'var(--muted)' }}>{item.project}</span>,
    dueDate:   <span style={{ color: 'var(--muted)' }}>{formatDate(item.dueDate)}</span>,
    dueIn:     <CountdownBadge daysUntil={item.daysUntil} />,
    assignees: item.assignees?.length > 0
      ? <span style={{ color: 'var(--muted)' }}>{item.assignees.join(', ')}</span>
      : <span style={{ color: 'var(--tint-amber-fg)', fontWeight: 600, fontSize: 11 }}>Unassigned</span>,
    status:    <StatusBadge status={item.status} />,
  }))
  return (
    <Panel title="Upcoming Deadlines (7 days)" count={items.length} countColor={items.length > 0 ? 'var(--tint-amber-fg)' : undefined} accent="var(--tint-amber-fg)">
      <DataTable cols={cols} rows={rows} emptyIcon="🗓️" emptyMsg="No deadlines in the next 7 days." />
    </Panel>
  )
}

function UnassignedPanel({ items }) {
  const cols = [
    { key: 'title',   label: 'Title' },
    { key: 'type',    label: 'Type',    w: 90 },
    { key: 'project', label: 'Project', w: 140 },
    { key: 'created', label: 'Created', w: 110 },
  ]
  const rows = items.map(item => ({
    title:   <Link href={item.type === 'task' ? `/projects/${item.slug}/tasks` : `/projects/${item.slug}`} style={{ fontWeight: 500, color: 'var(--accent)' }}>{item.title}</Link>,
    type:    <TypeBadge type={item.type} />,
    project: <span style={{ color: 'var(--muted)' }}>{item.project}</span>,
    created: <span style={{ color: 'var(--muted)' }}>{formatDate(item.createdAt)}</span>,
  }))
  return (
    <Panel title="Unassigned Items" count={items.length} countColor={items.length > 0 ? 'var(--tint-amber-fg)' : undefined} accent="var(--tint-amber-fg)">
      <DataTable cols={cols} rows={rows} emptyIcon="🎯" emptyMsg="No unassigned open items — great coverage!" />
    </Panel>
  )
}

function WorkloadPanel({ items }) {
  const max = items.length > 0 ? items[0].count : 1
  const palette = ['#7c3aed', '#1d4ed8', '#0891b2', '#059669', '#d97706', '#dc2626']
  const totalOpen = items.reduce((s, i) => s + i.count, 0)
  return (
    <Panel title="Team Workload" count={items.length > 0 ? `${totalOpen} open` : undefined} accent="var(--accent)">
      {items.length === 0
        ? <Empty icon="👥" message="No open tasks assigned to anyone yet." />
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {items.map((item, i) => {
              const pct = Math.round((item.count / max) * 100)
              const color = palette[i % palette.length]
              return (
                <div key={item.assignee} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 120, flexShrink: 0, fontSize: 13, fontWeight: 500,
                    textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    color: 'var(--text)',
                  }}>
                    {item.assignee}
                  </div>
                  <HBar pct={pct} color={color} height={14} />
                  <div style={{ width: 28, flexShrink: 0, fontSize: 13, fontWeight: 800, color, textAlign: 'right' }}>
                    {item.count}
                  </div>
                </div>
              )
            })}
          </div>
        )
      }
    </Panel>
  )
}

function CompletionPanel({ items }) {
  return (
    <Panel title="Project Completion" count={items.length > 0 ? `${items.length} project${items.length !== 1 ? 's' : ''}` : undefined} accent="var(--tint-green-fg)">
      {items.length === 0
        ? <Empty icon="📊" message="No projects with tasks yet." />
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {items.map(item => {
              const color = item.pct === 100 ? 'var(--tint-green-fg)' : item.pct >= 60 ? 'var(--tint-blue-fg)' : item.pct >= 30 ? 'var(--tint-amber-fg)' : 'var(--tint-red-fg)'
              return (
                <div key={item.slug}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <Link href={`/projects/${item.slug}`} style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>
                      {item.project}
                    </Link>
                    <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 12, flexShrink: 0 }}>
                      {item.done}/{item.total}
                      <span style={{ fontWeight: 800, color, marginLeft: 6 }}>{item.pct}%</span>
                    </span>
                  </div>
                  <HBar pct={item.pct} color={color} height={10} />
                </div>
              )
            })}
          </div>
        )
      }
    </Panel>
  )
}

function PendingProposalsPanel({ items }) {
  const max = items.length > 0 ? items[0].count : 1
  return (
    <Panel
      title="Pending Proposals"
      count={items.length > 0 ? `${items.reduce((s, i) => s + i.count, 0)} total` : undefined}
      countColor={items.length > 0 ? 'var(--tint-amber-fg)' : undefined}
      accent="var(--tint-amber-fg)"
    >
      {items.length === 0
        ? <Empty icon="📋" message="No pending proposals awaiting review." />
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {items.map((item) => {
              const pct = Math.round((item.count / max) * 100)
              const color = item.count >= 5 ? 'var(--tint-red-fg)' : item.count >= 3 ? 'var(--tint-amber-fg)' : 'var(--tint-blue-fg)'
              return (
                <div key={item.slug} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 150, flexShrink: 0, fontSize: 13 }}>
                    <Link href={`/projects/${item.slug}`} style={{ fontWeight: 600, color: 'var(--accent)' }}>
                      {item.project}
                    </Link>
                  </div>
                  <HBar pct={pct} color={color} height={14} />
                  <div style={{ width: 22, flexShrink: 0, fontSize: 13, fontWeight: 800, color, textAlign: 'right' }}>
                    {item.count}
                  </div>
                </div>
              )
            })}
          </div>
        )
      }
    </Panel>
  )
}

function VelocityPanel({ velocity }) {
  if (!velocity) return null
  const { thisWeek, lastWeek } = velocity
  const delta = thisWeek - lastWeek
  const trend = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'
  const trendColor = trend === 'up' ? 'var(--tint-green-fg)' : trend === 'down' ? 'var(--tint-red-fg)' : 'var(--tint-gray-fg)'
  const trendLabel = trend === 'up' ? `▲ +${delta} vs last week` : trend === 'down' ? `▼ ${delta} vs last week` : '= Same as last week'
  const max = Math.max(thisWeek, lastWeek, 1)
  const bars = [
    { label: 'This week', value: thisWeek, color: 'var(--accent)' },
    { label: 'Last week', value: lastWeek, color: 'var(--tint-amber-fg)' },
  ]
  return (
    <Panel title="Task Velocity" accent="var(--accent)">
      {thisWeek === 0 && lastWeek === 0
        ? <Empty icon="⚡" message="No tasks completed yet in the audit log." />
        : (
          <div>
            <div style={{ display: 'flex', gap: 32, alignItems: 'flex-end', height: 110, marginBottom: 12 }}>
              {bars.map(bar => {
                const h = Math.max(Math.round((bar.value / max) * 80), 8)
                return (
                  <div key={bar.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 22, fontWeight: 900, color: bar.color }}>{bar.value}</span>
                    <div style={{
                      width: 56, height: h, background: bar.color,
                      borderRadius: '6px 6px 0 0', opacity: 0.85,
                      transition: 'height .3s ease',
                    }} />
                    <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>{bar.label}</span>
                  </div>
                )
              })}
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: trendColor }}>{trendLabel}</span>
          </div>
        )
      }
    </Panel>
  )
}

function ActivityPanel({ items }) {
  const now = Date.now()
  const cols = [
    { key: 'project', label: 'Project' },
    { key: 'action',  label: 'Action',  w: 160 },
    { key: 'who',     label: 'Who',     w: 130 },
    { key: 'when',    label: 'When',    w: 110 },
  ]
  const rows = items.map(item => {
    const stale = item.timestamp && (now - new Date(item.timestamp).getTime()) > 7 * 86400000
    return {
      project: <Link href={`/projects/${item.slug}`} style={{ fontWeight: 600, color: 'var(--accent)' }}>{item.project}</Link>,
      action:  <span style={{ color: 'var(--muted)' }}>{item.action ? (ACTION_LABELS[item.action] || item.action) : '—'}</span>,
      who: item.user
        ? <span>{item.user.name}{item.user.username && <span style={{ color: 'var(--muted)', marginLeft: 4, fontSize: 11 }}>@{item.user.username}</span>}</span>
        : <span style={{ color: 'var(--muted)' }}>—</span>,
      when: (
        <span style={{ color: stale ? 'var(--tint-amber-fg)' : 'var(--muted)', fontWeight: stale ? 700 : 400, fontSize: 12 }}>
          {timeAgo(item.timestamp)}{stale && <span style={{ marginLeft: 5, fontSize: 10, background: 'var(--tint-amber-bg)', color: 'var(--tint-amber-fg)', borderRadius: 4, padding: '1px 5px' }}>stale</span>}
        </span>
      ),
    }
  })
  return (
    <Panel title="Last Activity per Project" count={items.length} accent="var(--tint-gray-fg)">
      <DataTable cols={cols} rows={rows} emptyIcon="📭" emptyMsg="No activity recorded yet." />
    </Panel>
  )
}

function ActiveSprintsPanel({ items }) {
  if (!items || items.length === 0) {
    return (
      <Panel title="Active Sprints" accent="var(--tint-indigo-fg)">
        <Empty icon="⚡" message="No active sprints across any project." />
      </Panel>
    )
  }
  return (
    <Panel title="Active Sprints" count={items.length} countColor="var(--tint-indigo-fg)" accent="var(--tint-indigo-fg)">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, borderRadius: 8, border: '1px solid var(--border)', overflow: 'hidden' }}>
        {items.map((item, i) => {
          const isOverdue = item.daysLeft !== null && item.daysLeft < 0
          const soonEnd   = item.daysLeft !== null && item.daysLeft >= 0 && item.daysLeft <= 2
          const color = item.pct === 100 ? 'var(--tint-green-fg)' : item.pct >= 60 ? 'var(--tint-blue-fg)' : item.pct >= 30 ? 'var(--tint-amber-fg)' : 'var(--tint-indigo-fg)'
          const dayColor  = isOverdue ? 'var(--tint-red-fg)' : soonEnd ? 'var(--tint-amber-fg)' : 'var(--tint-green-fg)'
          const dayBg     = isOverdue ? 'var(--tint-red-bg)' : soonEnd ? 'var(--tint-amber-bg)' : 'var(--tint-green-bg)'
          return (
            <div key={item.slug} style={{
              display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
              padding: '12px 16px',
              borderBottom: i < items.length - 1 ? '1px solid var(--border)' : 'none',
              background: 'var(--surface)',
            }}>
              <div style={{ minWidth: 140, flexShrink: 0 }}>
                <Link href={`/projects/${item.slug}/tasks`} style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>
                  {item.project}
                </Link>
                <div style={{ fontSize: 11, color: 'var(--tint-indigo-fg)', fontWeight: 600, marginTop: 2 }}>{item.sprintName}</div>
              </div>

              <div style={{ flex: 1, minWidth: 120, display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, height: 8, background: 'var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${item.pct}%`, background: color, borderRadius: 8, minWidth: item.pct > 0 ? 4 : 0 }} />
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, color, whiteSpace: 'nowrap' }}>{item.done}/{item.total}</span>
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                {item.endDate && (
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                    ends {new Date(item.endDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </span>
                )}
                {item.daysLeft !== null && (
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                    background: dayBg, color: dayColor, border: `1px solid ${dayColor}33`, whiteSpace: 'nowrap',
                  }}>
                    {isOverdue ? `${Math.abs(item.daysLeft)}d overdue` : item.daysLeft === 0 ? 'Ends today' : `${item.daysLeft}d left`}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

function StaleProjectsPanel({ items }) {
  const cols = [
    { key: 'project', label: 'Project' },
    { key: 'action',  label: 'Last Action', w: 160 },
    { key: 'who',     label: 'Who',         w: 130 },
    { key: 'when',    label: 'Last Active', w: 120 },
  ]
  const rows = items.map(item => ({
    project: <Link href={`/projects/${item.slug}`} style={{ fontWeight: 600, color: 'var(--accent)' }}>{item.project}</Link>,
    action:  <span style={{ color: 'var(--muted)' }}>{item.action ? (ACTION_LABELS[item.action] || item.action) : '—'}</span>,
    who: item.user
      ? <span>{item.user.name}{item.user.username && <span style={{ color: 'var(--muted)', marginLeft: 4, fontSize: 11 }}>@{item.user.username}</span>}</span>
      : <span style={{ color: 'var(--muted)' }}>—</span>,
    when: <span style={{ color: 'var(--tint-gray-fg)', fontWeight: 700, fontSize: 12 }}>{timeAgo(item.timestamp)}</span>,
  }))
  return (
    <Panel title={`Stale Projects (${STALE_DAYS}+ days inactive)`} count={items.length} countColor={items.length > 0 ? 'var(--tint-gray-fg)' : undefined} accent="var(--tint-gray-fg)">
      <DataTable cols={cols} rows={rows} emptyIcon="✅" emptyMsg={`All projects had activity within the last ${STALE_DAYS} days.`} />
    </Panel>
  )
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonDashboard() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 14 }}>
        {[...Array(8)].map((_, i) => (
          <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span className="skeleton" style={{ width: 28, height: 28, borderRadius: 6 }} />
            <span className="skeleton" style={{ width: '60%', height: 28, borderRadius: 4 }} />
            <span className="skeleton" style={{ width: '80%', height: 11, borderRadius: 4 }} />
          </div>
        ))}
      </div>
      {[1, 2, 3].map(n => (
        <div key={n} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
            <span className="skeleton" style={{ width: 180, height: 16, borderRadius: 4 }} />
          </div>
          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span className="skeleton" style={{ width: '100%', height: 12, borderRadius: 4 }} />
            <span className="skeleton" style={{ width: '85%', height: 12, borderRadius: 4 }} />
            <span className="skeleton" style={{ width: '70%', height: 12, borderRadius: 4 }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [refreshedAt, setRefreshedAt] = useState(null)

  function load() {
    setLoading(true)
    setError(null)
    fetch('/api/dashboard')
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => { setData(d); setRefreshedAt(new Date()) })
      .catch(() => setError('Failed to load dashboard data.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const staleProjects = data
    ? data.lastUpdates.filter(item => !item.timestamp || (Date.now() - new Date(item.timestamp).getTime()) > STALE_DAYS * 86400000)
    : []

  const totalIssues       = data ? data.overdue.length + data.unassigned.length : 0
  const pendingTotal      = data ? (data.pendingProposals || []).reduce((s, i) => s + i.count, 0) : 0
  const velocityDelta     = data?.velocity ? data.velocity.thisWeek - data.velocity.lastWeek : 0
  const velocityColor     = velocityDelta > 0 ? 'var(--tint-green-fg)' : velocityDelta < 0 ? 'var(--tint-red-fg)' : 'var(--tint-gray-fg)'

  return (
    <>
      <Nav />
      <main className="page">

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 28 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>Insights Dashboard</h1>
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>
              Health overview across all projects — overdue items, workload, and activity.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {refreshedAt && (
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                Updated {timeAgo(refreshedAt)}
              </span>
            )}
            <button
              className="btn-ghost"
              onClick={load}
              disabled={loading}
              style={{ fontSize: 12, padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <span style={{ display: 'inline-block', transform: loading ? 'rotate(360deg)' : 'none', transition: 'transform .3s' }}>↻</span>
              Refresh
            </button>
          </div>
        </div>

        {loading && <SkeletonDashboard />}

        {error && (
          <div style={{
            padding: '16px 20px', borderRadius: 10, background: 'var(--tint-red-bg)',
            border: '1px solid var(--tint-red-border)', color: 'var(--tint-red-fg)', fontSize: 13,
          }}>
            {error} — <button onClick={load} style={{ background: 'none', border: 'none', color: 'var(--tint-red-fg)', textDecoration: 'underline', padding: 0, cursor: 'pointer', fontSize: 13 }}>Try again</button>
          </div>
        )}

        {data && (
          <>
            {/* KPI row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 14, marginBottom: 28 }}>
              <StatCard icon="🚨" label="Overdue items"       value={data.overdue.length}          color={data.overdue.length > 0 ? 'var(--tint-red-fg)' : 'var(--tint-green-fg)'} />
              <StatCard icon="🔔" label="Due this week"       value={(data.upcoming || []).length}  color={(data.upcoming || []).length > 0 ? 'var(--tint-amber-fg)' : 'var(--tint-green-fg)'} />
              <StatCard icon="👤" label="Unassigned items"    value={data.unassigned.length}        color={data.unassigned.length > 0 ? 'var(--tint-amber-fg)' : 'var(--tint-green-fg)'} />
              <StatCard icon="⚠️" label="Total issues"        value={totalIssues}                   color={totalIssues > 0 ? 'var(--tint-red-fg)' : 'var(--tint-green-fg)'} />
              <StatCard icon="📁" label="Projects tracked"    value={data.lastUpdates.length}       color="var(--accent)" />
              <StatCard icon="🌫️" label="Stale projects"      value={staleProjects.length}          color={staleProjects.length > 0 ? 'var(--tint-gray-fg)' : 'var(--tint-green-fg)'} />
              <StatCard icon="📋" label="Pending proposals"   value={pendingTotal}                  color={pendingTotal > 0 ? 'var(--tint-amber-fg)' : 'var(--tint-green-fg)'} />
              <StatCard icon="⚡" label="Done this week"      value={data.velocity?.thisWeek ?? 0}  color={velocityColor}
                sub={velocityDelta !== 0 ? `${velocityDelta > 0 ? '+' : ''}${velocityDelta} vs last week` : 'Same as last week'} />
            </div>

            {/* Main panels */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <ActiveSprintsPanel items={data.activeSprints || []} />
              <OverduePanel items={data.overdue} />
              <UpcomingPanel items={data.upcoming || []} />

              {/* Two-column: completion + workload */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
                <CompletionPanel items={data.completion || []} />
                <WorkloadPanel items={data.workload || []} />
              </div>

              {/* Two-column: pending proposals + velocity */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
                <PendingProposalsPanel items={data.pendingProposals || []} />
                <VelocityPanel velocity={data.velocity} />
              </div>

              <UnassignedPanel items={data.unassigned} />
              <StaleProjectsPanel items={staleProjects} />
              <ActivityPanel items={data.lastUpdates} />
            </div>
          </>
        )}
      </main>
    </>
  )
}
