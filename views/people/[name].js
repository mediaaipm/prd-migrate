import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from '../../lib/router-compat'
import Nav from '../../components/Nav'
import PageHeader from '../../components/PageHeader'
import PersonLink from '../../components/PersonLink'
import { apiFetch } from '../../lib/api-fetch'
import { onSync } from '../../lib/submit-queue'
import { DEFAULT_COLUMNS, labelForStatus } from '../../lib/kanban-columns'
import { roleLabel } from '../../lib/roles'
import { Sparkline, StackBar, WeeklyBars } from '../../components/InsightsCharts'
import { Row } from '../my-tasks'

// A person's performance (/people/{name}, GET /api/people/{name}). Every name in the app
// links here through components/PersonLink.js. Who may open it is decided on the server
// (lib/team.js canViewPerson); numbers cover only the projects the viewer can see.
// `?project=<slug>` narrows to one project.

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

function Card({ title, sub, children }) {
  return (
    <section className="ins-card">
      <div className="ins-card-head">
        <span className="ins-card-title">{title}{sub && <span className="ins-card-sub">{sub}</span>}</span>
      </div>
      <div className="ins-card-body">{children}</div>
    </section>
  )
}

const pct = (a, b) => (b ? Math.round((a / b) * 100) : null)
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function decodeName(v) {
  if (typeof v !== 'string') return ''
  try { return decodeURIComponent(v) } catch { return v }
}

export default function Person({ currentUser }) {
  const router = useRouter()
  const name = decodeName(router.query.name)
  const project = typeof router.query.project === 'string' ? router.query.project : ''
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('open')

  const load = useCallback(async () => {
    if (!name) return
    try {
      const res = await apiFetch(`/api/people/${encodeURIComponent(name)}${project ? `?project=${encodeURIComponent(project)}` : ''}`)
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setError(d.error || 'Could not load this person.'); setData(null); return }
      setError(''); setData(d)
    } catch {
      setError('Could not load this person.')
    }
  }, [name, project])
  useEffect(() => { if (currentUser) { setData(null); load() } }, [currentUser, load])
  useEffect(() => onSync(load), [load])

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() }, [])
  const projectBySlug = useMemo(() => new Map((data?.byProject || []).map(p => [p.slug, p])), [data])

  function pickProject(slug) {
    router.push(`/people/${encodeURIComponent(name)}${slug ? `?project=${encodeURIComponent(slug)}` : ''}`)
  }

  const s = data?.stats
  const fp = s ? pct(s.firstPass30, s.passed30) : null
  const onTime = data ? pct(s.onTime30, s.dueDone30) : null
  const parts = s ? DEFAULT_COLUMNS
    .filter(c => s.byStatus[c.status])
    .map(c => ({ key: c.status, label: c.label, color: c.color, count: s.byStatus[c.status] }))
    .concat(Object.keys(s.byStatus).filter(k => !DEFAULT_COLUMNS.some(c => c.status === k))
      .map(k => ({ key: k, label: labelForStatus(k), color: '#94a3b8', count: s.byStatus[k] }))) : []
  const thisWeek = s ? s.weekly[s.weekly.length - 1] : 0
  const lastWeek = s ? s.weekly[s.weekly.length - 2] || 0 : 0
  const isMe = currentUser?.name === name
  const reviewed = data ? data.reviewed30.pass + data.reviewed30.rework : 0

  return (
    <>
      <Nav />
      <main className="page page--full ins-page">
        <PageHeader
          title={name || 'Person'}
          subtitle={isMe ? 'Your work and how it is going, in the projects you can see.' : 'Their work and how it is going, in the projects you can see.'}
          actions={data && data.projects.length > 1 ? (
            <select className="form-input person-project" value={project} onChange={e => pickProject(e.target.value)} aria-label="Project">
              <option value="">All projects</option>
              {data.projects.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}
            </select>
          ) : null}
        />

        {error && <div className="section-card epic-empty">{error}</div>}
        {!data && !error && (
          <div className="ins-top">{[0, 1, 2, 3, 4].map(i => <span key={i} className="skeleton ins-skel-stat" />)}</div>
        )}

        {data && (
          <>
            <div className="ins-top">
              <section className="ins-hero person-hero">
                <div className="person-hero-top">
                  <span className="my-person-avatar person-avatar" aria-hidden="true">{name.charAt(0).toUpperCase()}</span>
                  <div>
                    <div className="team-hero-name">{name}</div>
                    <div className="ins-stat-sub">
                      {data.exists ? roleLabel(data.role) : 'Not a current account'}
                      {data.lead && <> · reports to <PersonLink name={data.lead} className="person-inline" /></>}
                    </div>
                  </div>
                </div>
                {data.reports.length > 0 && (
                  <div className="person-reports">
                    <span className="ins-stat-sub">Leads</span>
                    {data.reports.map(r => <PersonLink key={r} name={r} className="person-chip" />)}
                  </div>
                )}
                {!data.exists && <div className="ins-stat-sub person-note">Tasks still name this person, but there is no account with this name.</div>}
              </section>
              <Stat label="Open" value={s.open} sub={`${s.openPoints} pts · ${s.inProgress} in progress`} />
              <Stat label="Overdue" value={s.overdue} tone={s.overdue ? 'red' : 'green'} sub={s.dueSoon ? `${s.dueSoon} more due this week` : 'Nothing else due this week'} />
              <Stat label="Done (30d)" value={s.done30} trend={<Sparkline values={s.weekly} label="Done per week" />} sub={`${s.points30} pts · ${thisWeek} this week, ${lastWeek} last`} />
              <Stat label="On time (30d)" value={onTime == null ? '—' : `${onTime}%`} tone={onTime == null ? null : onTime >= 80 ? 'green' : onTime >= 50 ? 'amber' : 'red'} sub={s.dueDone30 ? `${s.onTime30} of ${plural(s.dueDone30, 'task')} with a due date` : 'Nothing with a due date finished'} />
            </div>

            <div className="ins-layout">
              <div className="ins-col">
                <Card title="Throughput" sub={`tasks done per week, last ${data.weeks} weeks`}>
                  <WeeklyBars values={s.weekly} label={`Tasks done per week by ${name}`} />
                </Card>
                <Card title={tab === 'open' ? 'Open tasks' : 'Done in the last 30 days'}>
                  <div className="epic-filters person-tabs" role="tablist">
                    <button role="tab" aria-selected={tab === 'open'} className={`epic-filter${tab === 'open' ? ' is-on' : ''}`} onClick={() => setTab('open')}>Open<span className="epic-filter-count">{data.openTotal}</span></button>
                    <button role="tab" aria-selected={tab === 'done'} className={`epic-filter${tab === 'done' ? ' is-on' : ''}`} onClick={() => setTab('done')}>Done<span className="epic-filter-count">{data.done.length}</span></button>
                  </div>
                  {(tab === 'open' ? data.open : data.done).length === 0 ? (
                    <div className="empty-state-sm">{tab === 'open' ? 'Nothing open.' : 'Nothing finished in the last 30 days.'}</div>
                  ) : (
                    <ul className="my-list person-list">
                      {(tab === 'open' ? data.open : data.done).map(item => (
                        <Row key={`${item.project}:${item.version || ''}:${item.id}`} item={item} project={projectBySlug.get(item.project)} today={today} />
                      ))}
                    </ul>
                  )}
                  {tab === 'open' && data.openTotal > data.open.length && (
                    <div className="ins-stat-sub person-more">Showing the {data.open.length} due soonest of {data.openTotal}.</div>
                  )}
                </Card>
              </div>
              <div className="ins-col">
                <Card title="Quality & flow" sub="last 30 days">
                  <dl className="person-facts">
                    <div><dt>QA first pass</dt><dd>{fp == null ? '—' : `${fp}%`}<span>{s.passed30 ? `${s.firstPass30} of ${plural(s.passed30, 'story', 'stories')} passed first time` : 'No stories passed QA'}</span></dd></div>
                    <div><dt>Sent back by QA</dt><dd>{s.sentBack30}<span>{s.rework ? `${s.rework} in Rework now` : 'Nothing in Rework now'}</span></dd></div>
                    <div><dt>Typical time to finish</dt><dd>{s.cycleDaysMedian == null ? '—' : s.cycleDaysMedian < 1 ? '<1d' : `${s.cycleDaysMedian}d`}<span>median, start (or creation) to done</span></dd></div>
                    <div><dt>Finished</dt><dd>{s.storiesDone30 + s.subtasksDone30}<span>{plural(s.storiesDone30, 'story', 'stories')} · {plural(s.subtasksDone30, 'sub-task')}</span></dd></div>
                    <div><dt>Carried over</dt><dd>{s.carryOver}<span>sprint carry-overs on open stories</span></dd></div>
                    <div><dt>Comments</dt><dd>{data.comments30}<span>written on tasks</span></dd></div>
                    {reviewed > 0 && <div><dt>QA reviews given</dt><dd>{reviewed}<span>{data.reviewed30.pass} passed · {data.reviewed30.rework} sent back</span></dd></div>}
                  </dl>
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
                {data.byProject.length > 0 && (
                  <Card title="By project">
                    <div className="person-table-wrap">
                    <table className="team-table person-projects">
                      <thead><tr><th>Project</th><th>Open</th><th>Overdue</th><th>Done (30d)</th><th>Points (30d)</th></tr></thead>
                      <tbody>
                        {data.byProject.map(p => (
                          <tr key={p.slug} onClick={() => pickProject(p.slug)} tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') pickProject(p.slug) }}>
                            <td><strong>{p.name}</strong></td>
                            <td>{p.open}</td>
                            <td className={p.overdue ? 'team-num--late' : ''}>{p.overdue}</td>
                            <td>{p.done30}</td>
                            <td>{p.points30}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                  </Card>
                )}
              </div>
            </div>
          </>
        )}
      </main>
    </>
  )
}
