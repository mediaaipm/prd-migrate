import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from '../lib/router-compat'
import Nav from '../components/Nav'
import PageHeader from '../components/PageHeader'
import { apiFetch } from '../lib/api-fetch'
import { onSync } from '../lib/submit-queue'
import { DEFAULT_COLUMNS, labelForStatus } from '../lib/kanban-columns'
import { roleLabel } from '../lib/roles'
import { Sparkline, StackBar, WeeklyBars } from '../components/InsightsCharts'

// Teams — who is on each team and how it is doing (GET /api/teams). Managers see every
// team; a team lead sees their own (and any lead's under them). Numbers cover only the
// projects the viewer can see. `?team=<lead>` opens one team; with several teams and
// none picked, the overview compares them.

function Stat({ label, value, sub, tone, trend }) {
  return (
    <div className="ins-stat">
      <div className="ins-stat-label">
        {tone && <span className={`ins-stat-dot ins-stat-dot--${tone}`} aria-hidden="true" />}
        {label}
      </div>
      <div className="ins-stat-row">
        <div className="ins-stat-value">{value}</div>
        {trend}
      </div>
      {sub && <div className="ins-stat-sub">{sub}</div>}
    </div>
  )
}

function Card({ title, sub, action, children }) {
  return (
    <section className="ins-card">
      <div className="ins-card-head">
        <span className="ins-card-title">{title}{sub && <span className="ins-card-sub">{sub}</span>}</span>
        {action && <span className="ins-card-action">{action}</span>}
      </div>
      <div className="ins-card-body">{children}</div>
    </section>
  )
}

const pct = (a, b) => (b ? Math.round((a / b) * 100) : null)
const teamName = lead => `${lead}'s team`
const tasksHref = (lead, person) => `/my-tasks?view=team&lead=${encodeURIComponent(lead)}${person ? `&person=${encodeURIComponent(person)}` : ''}`

function Overview({ teams, open }) {
  return (
    <div className="ins-card team-table-card">
      <table className="team-table">
        <thead>
          <tr>
            <th>Team</th><th>People</th><th>Open</th><th>Overdue</th><th>Rework</th><th>Done (30d)</th><th>Points (30d)</th><th>QA first pass</th>
          </tr>
        </thead>
        <tbody>
          {teams.map(t => {
            const s = t.stats
            const fp = pct(s.firstPass30, s.passed30)
            return (
              <tr key={t.lead} onClick={() => open(t.lead)} tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') open(t.lead) }}>
                <td>
                  <span className="team-cell-name">
                    <span className="my-person-avatar" aria-hidden="true">{t.lead.charAt(0).toUpperCase()}</span>
                    <span>
                      <strong>{teamName(t.lead)}</strong>
                      <span className="team-cell-sub">{roleLabel(t.leadRole)}{t.leadOf ? ` · reports to ${t.leadOf}` : ''}</span>
                    </span>
                  </span>
                </td>
                <td>{t.members.length}</td>
                <td>{s.open}</td>
                <td className={s.overdue ? 'team-num--late' : ''}>{s.overdue}</td>
                <td className={s.rework ? 'team-num--warn' : ''}>{s.rework}</td>
                <td>
                  <span className="team-cell-trend">{s.done30}<Sparkline values={s.weekly} label={`Done per week, ${teamName(t.lead)}`} /></span>
                </td>
                <td>{s.points30}</td>
                <td>{fp == null ? '—' : `${fp}%`}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function TeamDetail({ team, weeks }) {
  const s = team.stats
  const fp = pct(s.firstPass30, s.passed30)
  const parts = DEFAULT_COLUMNS
    .filter(c => s.byStatus[c.status])
    .map(c => ({ key: c.status, label: c.label, color: c.color, count: s.byStatus[c.status] }))
    .concat(Object.keys(s.byStatus).filter(k => !DEFAULT_COLUMNS.some(c => c.status === k))
      .map(k => ({ key: k, label: labelForStatus(k), color: '#94a3b8', count: s.byStatus[k] })))
  const loadMax = Math.max(1, ...team.members.map(m => m.stats.open))
  const prevWeek = s.weekly[s.weekly.length - 2] || 0
  const thisWeek = s.weekly[s.weekly.length - 1] || 0

  return (
    <>
      <div className="ins-top team-top">
        <section className="ins-hero">
          <div className="ins-stat-label">{roleLabel(team.leadRole)}{team.leadOf ? ` · reports to ${team.leadOf}` : ''}</div>
          <div className="team-hero-name">{teamName(team.lead)}</div>
          <div className="team-avatars" aria-label={`${team.members.length} people`}>
            {team.members.slice(0, 8).map(m => (
              <span key={m.name} className="my-person-avatar" title={`${m.name} · ${roleLabel(m.role)}`}>{m.name.charAt(0).toUpperCase()}</span>
            ))}
            <span className="ins-stat-sub">{team.members.length} {team.members.length === 1 ? 'person' : 'people'} · {s.projects} project{s.projects === 1 ? '' : 's'}</span>
          </div>
        </section>
        <Stat label="Open" value={s.open} sub={`${s.openPoints} pts · ${s.inProgress} in progress`} />
        <Stat label="Overdue" value={s.overdue} tone={s.overdue ? 'red' : 'green'} sub={s.dueSoon ? `${s.dueSoon} more due this week` : 'Nothing else due this week'} />
        <Stat label="Done (30d)" value={s.done30} trend={<Sparkline values={s.weekly} label="Done per week" />} sub={`${s.points30} pts · ${thisWeek} this week, ${prevWeek} last`} />
        <Stat label="QA first pass" value={fp == null ? '—' : `${fp}%`} tone={s.rework ? 'amber' : null} sub={`${s.passed30} passed (30d) · ${s.rework} in rework`} />
      </div>

      <div className="ins-layout">
        <div className="ins-col">
          <Card title="Throughput" sub={`tasks done per week, last ${weeks} weeks`}>
            <WeeklyBars values={s.weekly} label={`Tasks done per week by ${teamName(team.lead)}`} />
          </Card>
          <Card title="Open work" sub="by status">
            {s.open === 0 ? <div className="empty-state-sm">Nothing open.</div> : (
              <>
                <StackBar parts={parts} total={s.open} label="Open tasks by status" />
                <div className="team-status-legend">
                  {parts.map(p => (
                    <span key={p.key}><i className="team-status-dot" style={{ '--status-color': p.color }} />{p.label} <strong>{p.count}</strong></span>
                  ))}
                </div>
              </>
            )}
          </Card>
        </div>
        <div className="ins-col">
          <Card title="People" sub="open work, late part in red" action={<Link href={tasksHref(team.lead)} className="ins-link">All tasks</Link>}>
            <ul className="team-people">
              {team.members.map(m => {
                const ms = m.stats
                return (
                  <li key={m.name} className="team-person">
                    <span className="my-person-avatar" aria-hidden="true">{m.name.charAt(0).toUpperCase()}</span>
                    <div className="team-person-main">
                      <div className="team-person-top">
                        <Link href={tasksHref(team.lead, m.name)} className="team-person-name">{m.name}</Link>
                        <span className="team-person-role">{m.isLead ? 'Lead' : roleLabel(m.role)}</span>
                        <span className="team-person-nums">
                          {ms.open} open{ms.overdue > 0 && <span className="team-num--late"> · {ms.overdue} late</span>}{ms.rework > 0 && <span className="team-num--warn"> · {ms.rework} rework</span>}
                        </span>
                      </div>
                      <div className="ins-load-track">
                        <div className="ins-load-bar" style={{ width: `${(ms.open / loadMax) * 100}%` }}>
                          {ms.open - ms.overdue > 0 && <span className="ins-load-seg ins-load-seg--ok" style={{ flexGrow: ms.open - ms.overdue }} />}
                          {ms.overdue > 0 && <span className="ins-load-seg ins-load-seg--late" style={{ flexGrow: ms.overdue }} />}
                        </div>
                      </div>
                      <div className="team-person-sub">{ms.done30} done · {ms.points30} pts in 30 days{ms.review ? ` · ${ms.review} in QA` : ''}</div>
                    </div>
                  </li>
                )
              })}
            </ul>
          </Card>
        </div>
      </div>
    </>
  )
}

export default function Teams({ currentUser }) {
  const router = useRouter()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/teams')
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setError(d.error || 'Could not load teams.'); return }
      setError(''); setData(d)
    } catch {
      setError('Could not load teams.')
    }
  }, [])
  useEffect(() => { if (currentUser) load() }, [currentUser, load])
  useEffect(() => onSync(load), [load])

  const teams = data?.teams || []
  const picked = typeof router.query.team === 'string' ? router.query.team : ''
  const team = useMemo(() => teams.find(t => t.lead === picked) || (teams.length === 1 ? teams[0] : null), [teams, picked])
  const open = lead => router.push(lead ? `/teams?team=${encodeURIComponent(lead)}` : '/teams')
  const isManager = currentUser?.role === 'manager'

  return (
    <>
      <Nav />
      <main className="page page--full ins-page">
        <PageHeader
          title={team ? teamName(team.lead) : 'Teams'}
          subtitle={isManager ? 'Every team: who is on it and how it is doing, in the projects you can see.' : 'Your team: who is on it and how it is doing, in the projects you can see.'}
        />

        {teams.length > 1 && (
          <div className="epic-filters" role="tablist">
            <button role="tab" aria-selected={!team} className={`epic-filter${!team ? ' is-on' : ''}`} onClick={() => open('')}>Overview</button>
            {teams.map(t => (
              <button key={t.lead} role="tab" aria-selected={team?.lead === t.lead} className={`epic-filter${team?.lead === t.lead ? ' is-on' : ''}`} onClick={() => open(t.lead)}>
                {teamName(t.lead)}<span className="epic-filter-count">{t.members.length}</span>
              </button>
            ))}
          </div>
        )}

        {error && <div className="kanban-col-error">{error}</div>}
        {!data && !error && (
          <div className="ins-top">{[0, 1, 2, 3, 4].map(i => <span key={i} className="skeleton ins-skel-stat" />)}</div>
        )}
        {data && teams.length === 0 && (
          <div className="section-card epic-empty">
            {isManager ? 'No teams are set up yet.' : 'Nobody reports to you yet.'} An admin or manager sets each person's team lead under Admin → Users → Reports to.
          </div>
        )}
        {data && !team && teams.length > 1 && <Overview teams={teams} open={open} />}
        {data && team && <TeamDetail team={team} weeks={data.weeks} />}
      </main>
    </>
  )
}
