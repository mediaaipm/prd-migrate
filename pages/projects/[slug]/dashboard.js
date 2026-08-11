import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import Nav from '../../../components/Nav'
import { apiFetch } from '../../../lib/api-fetch'

function ProgressBar({ pct, color }) {
  const c = color || (pct === 100 ? 'var(--tint-green-fg)' : pct >= 60 ? 'var(--tint-blue-fg)' : pct >= 30 ? 'var(--tint-amber-fg)' : 'var(--accent)')
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ flex: 1, height: 8, background: 'var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: c, borderRadius: 8, transition: 'width .4s ease', minWidth: pct > 0 ? 4 : 0 }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color: c, whiteSpace: 'nowrap', minWidth: 36, textAlign: 'right' }}>{pct}%</span>
    </div>
  )
}

function StatCard({ label, value, sub, color, wide }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: '18px 22px',
      gridColumn: wide ? 'span 2' : undefined,
    }}>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6, fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color: color || 'var(--text)', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

function SectionCard({ title, badge, badgeColor, children, action }) {
  return (
    <section style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '14px 18px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
      }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>{title}</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {badge !== undefined && (
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
              background: badgeColor ? `color-mix(in srgb, ${badgeColor} 15%, transparent)` : 'var(--tint-slate-bg)',
              color: badgeColor || 'var(--muted)',
            }}>{badge}</span>
          )}
          {action}
        </div>
      </div>
      <div style={{ padding: '12px 18px' }}>{children}</div>
    </section>
  )
}

function ItemRow({ icon, title, meta, right }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      gap: 8, padding: '7px 0', borderBottom: '1px solid var(--border)',
    }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flex: 1, minWidth: 0 }}>
        {icon && <span style={{ fontSize: 13, marginTop: 1 }}>{icon}</span>}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
          {meta && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{meta}</div>}
        </div>
      </div>
      {right && <div style={{ flexShrink: 0 }}>{right}</div>}
    </div>
  )
}

function Tag({ label, color, bg }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 6,
      background: bg || 'var(--tint-slate-bg)', color: color || 'var(--muted)',
      whiteSpace: 'nowrap',
    }}>{label}</span>
  )
}

export default function ProjectDashboard({ currentUser }) {
  const router = useRouter()
  const { slug } = router.query
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!slug) return
    setLoading(true)
    apiFetch(`/api/projects/${slug}/dashboard`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setError(String(e)); setLoading(false) })
  }, [slug])

  if (loading) return (
    <>
      <Nav />
      <main className="page">
        <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
          {[140, 200, 160].map((w, i) => <span key={i} className="skeleton" style={{ width: w, height: 13, borderRadius: 6 }} />)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
          {[0,1,2,3].map(i => <span key={i} className="skeleton" style={{ height: 88, borderRadius: 12 }} />)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {[0,1,2,3].map(i => <span key={i} className="skeleton" style={{ height: 180, borderRadius: 12 }} />)}
        </div>
      </main>
    </>
  )

  if (error || !data) return (
    <>
      <Nav />
      <main className="page">
        <div className="empty-state">{error === '404' ? 'Project not found.' : 'Failed to load dashboard.'}</div>
      </main>
    </>
  )

  const { project, completion, statusCounts, pendingProposals, activeSprint, overdue, upcoming, unassigned, workload, velocity } = data

  const velocityDelta = velocity.lastWeek > 0
    ? Math.round(((velocity.thisWeek - velocity.lastWeek) / velocity.lastWeek) * 100)
    : velocity.thisWeek > 0 ? 100 : 0
  const velocityColor = velocityDelta > 0 ? 'var(--tint-green-fg)' : velocityDelta < 0 ? 'var(--tint-red-fg)' : 'var(--muted)'

  return (
    <>
      <Nav />
      <main className="page">
        {/* Breadcrumb + header */}
        <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 4 }}>
              <Link href="/">Projects</Link> / <Link href={`/projects/${slug}`}>{project.name}</Link> / Dashboard
            </div>
            <h1 style={{ marginBottom: 4 }}>{project.name} — Dashboard</h1>
            {project.description && <p style={{ color: 'var(--muted)', fontSize: 14 }}>{project.description}</p>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Link href={`/projects/${slug}`} className="btn-ghost" style={{ fontSize: 13, padding: '6px 14px', textDecoration: 'none' }}>Overview</Link>
            <Link href={`/projects/${slug}/tasks`} className="btn-ghost" style={{ fontSize: 13, padding: '6px 14px', textDecoration: 'none' }}>Tasks</Link>
          </div>
        </div>

        {/* Stat strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, marginBottom: 24 }}>
          <StatCard label="Tasks Done" value={`${completion.done}/${completion.total}`} sub={`${completion.pct}% complete`} color={completion.pct === 100 ? 'var(--tint-green-fg)' : 'var(--tint-blue-fg)'} />
          <StatCard label="Overdue" value={overdue.length} sub={overdue.length > 0 ? 'need attention' : 'all on track'} color={overdue.length > 0 ? 'var(--tint-red-fg)' : 'var(--tint-green-fg)'} />
          <StatCard label="Pending Proposals" value={pendingProposals} sub="awaiting action" color={pendingProposals > 0 ? 'var(--tint-amber-fg)' : 'var(--muted)'} />
          <StatCard
            label="Velocity (this wk)"
            value={velocity.thisWeek}
            sub={velocity.lastWeek > 0 ? `${velocityDelta > 0 ? '+' : ''}${velocityDelta}% vs last wk` : `last wk: ${velocity.lastWeek}`}
            color={velocityColor}
          />
          <StatCard label="Unassigned" value={unassigned.length} sub="tasks & proposals" color={unassigned.length > 0 ? 'var(--accent)' : 'var(--muted)'} />
          <StatCard label="Due This Week" value={upcoming.length} sub="upcoming deadlines" color={upcoming.length > 0 ? 'var(--tint-amber-fg)' : 'var(--muted)'} />
        </div>

        {/* Completion bar */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 22px', marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 10 }}>Overall Task Completion</div>
          <ProgressBar pct={completion.pct} />
          {Object.keys(statusCounts).length > 0 && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
              {Object.entries(statusCounts).sort(([,a],[,b]) => b - a).map(([status, count]) => {
                const colorMap = { done: 'var(--tint-green-fg)', 'in-progress': 'var(--tint-blue-fg)', todo: 'var(--muted)', blocked: 'var(--tint-red-fg)', 'in-review': 'var(--accent)' }
                return (
                  <span key={status} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: colorMap[status] || 'var(--border)', display: 'inline-block' }} />
                    <span style={{ color: 'var(--muted)', fontWeight: 500 }}>{status}</span>
                    <span style={{ color: 'var(--muted)' }}>{count}</span>
                  </span>
                )
              })}
            </div>
          )}
        </div>

        {/* Active sprint */}
        {activeSprint && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 22px', marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
              <div>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Active Sprint: {activeSprint.name}</span>
                {activeSprint.endDate && (
                  <span style={{ fontSize: 12, color: activeSprint.daysLeft != null && activeSprint.daysLeft <= 2 ? 'var(--tint-red-fg)' : 'var(--muted)', marginLeft: 10 }}>
                    {activeSprint.daysLeft != null ? (activeSprint.daysLeft < 0 ? 'Overdue' : `${activeSprint.daysLeft}d left`) : activeSprint.endDate}
                  </span>
                )}
              </div>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                {activeSprint.startDate && new Date(activeSprint.startDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                {activeSprint.startDate && activeSprint.endDate && ' – '}
                {activeSprint.endDate && new Date(activeSprint.endDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
            </div>
            <ProgressBar pct={activeSprint.pct} />
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>{activeSprint.done} of {activeSprint.total} tasks done</div>
          </div>
        )}

        {/* 2-col grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>

          {/* Overdue */}
          <SectionCard
            title="Overdue"
            badge={overdue.length}
            badgeColor={overdue.length > 0 ? 'var(--tint-red-fg)' : undefined}
          >
            {overdue.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', padding: '12px 0' }}>Nothing overdue</div>
            ) : overdue.slice(0, 8).map((item, i) => (
              <ItemRow
                key={i}
                icon={item.type === 'task' ? '📋' : '📝'}
                title={item.title}
                meta={`${item.daysOverdue}d overdue · ${item.assignees.length ? item.assignees.join(', ') : 'unassigned'}`}
                right={<Tag label={item.type} color="var(--tint-red-fg)" bg="var(--tint-red-bg)" />}
              />
            ))}
            {overdue.length > 8 && <div style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', paddingTop: 8 }}>+{overdue.length - 8} more</div>}
          </SectionCard>

          {/* Upcoming */}
          <SectionCard
            title="Due This Week"
            badge={upcoming.length}
            badgeColor={upcoming.length > 0 ? 'var(--tint-amber-fg)' : undefined}
          >
            {upcoming.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', padding: '12px 0' }}>Nothing due this week</div>
            ) : upcoming.slice(0, 8).map((item, i) => (
              <ItemRow
                key={i}
                icon={item.type === 'task' ? '📋' : '📝'}
                title={item.title}
                meta={`${item.daysUntil === 0 ? 'due today' : `in ${item.daysUntil}d`} · ${item.assignees.length ? item.assignees.join(', ') : 'unassigned'}`}
                right={<Tag label={item.daysUntil === 0 ? 'today' : `${item.daysUntil}d`} color={item.daysUntil <= 1 ? 'var(--tint-red-fg)' : 'var(--tint-amber-fg)'} bg={item.daysUntil <= 1 ? 'var(--tint-red-bg)' : 'var(--tint-amber-bg)'} />}
              />
            ))}
            {upcoming.length > 8 && <div style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', paddingTop: 8 }}>+{upcoming.length - 8} more</div>}
          </SectionCard>

          {/* Unassigned */}
          <SectionCard
            title="Unassigned"
            badge={unassigned.length}
            badgeColor={unassigned.length > 0 ? 'var(--accent)' : undefined}
          >
            {unassigned.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', padding: '12px 0' }}>All items assigned</div>
            ) : unassigned.slice(0, 8).map((item, i) => (
              <ItemRow
                key={i}
                icon={item.type === 'task' ? '📋' : '📝'}
                title={item.title}
                right={<Tag label={item.type} color="var(--accent)" bg="var(--tint-violet-bg)" />}
              />
            ))}
            {unassigned.length > 8 && <div style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', paddingTop: 8 }}>+{unassigned.length - 8} more</div>}
          </SectionCard>

          {/* Workload */}
          <SectionCard
            title="Workload by Assignee"
            badge={workload.length > 0 ? workload.length : undefined}
          >
            {workload.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', padding: '12px 0' }}>No active assignments</div>
            ) : (() => {
              const max = workload[0]?.count || 1
              return workload.map((w, i) => (
                <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{w.assignee}</span>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>{w.count} open</span>
                  </div>
                  <div style={{ height: 6, background: 'var(--border)', borderRadius: 6, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.round((w.count / max) * 100)}%`, background: 'var(--tint-indigo-fg)', borderRadius: 6 }} />
                  </div>
                </div>
              ))
            })()}
          </SectionCard>

        </div>

        {/* Quick links */}
        <div style={{ marginTop: 24, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link href={`/projects/${slug}/tasks`} className="btn-ghost" style={{ fontSize: 13, textDecoration: 'none' }}>View Tasks</Link>
          <Link href={`/projects/${slug}`} className="btn-ghost" style={{ fontSize: 13, textDecoration: 'none' }}>PRD Versions</Link>
          <Link href={`/dashboard`} className="btn-ghost" style={{ fontSize: 13, textDecoration: 'none' }}>Global Dashboard</Link>
        </div>
      </main>
    </>
  )
}
