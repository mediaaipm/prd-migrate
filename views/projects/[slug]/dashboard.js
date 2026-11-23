import { useState, useEffect } from 'react'
import { useRouter } from '../../../lib/router-compat'
import Link from 'next/link'
import Nav from '../../../components/Nav'
import PersonLink from '../../../components/PersonLink'
import PageHeader from '../../../components/PageHeader'
import { apiFetch } from '../../../lib/api-fetch'
import { useColumns, labelForStatus } from '../../../lib/kanban-columns'
import { Burndown, HistoryColumns, Sparkline, StackBar } from '../../../components/InsightsCharts'

// Insights — the project at a glance, built to answer five questions in order:
// how far along are we, is the sprint on track, how is QA going, what needs
// attention, who is loaded. Charts live in components/InsightsCharts.js.

const fmtDate = iso => (iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '')

function Bar({ pct, tone, marker }) {
  return (
    <div className={`ins-bar${tone ? ` ins-bar--${tone}` : ''}`}>
      <div className="ins-bar-fill" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      {marker != null && <div className="ins-bar-marker" style={{ left: `${Math.max(0, Math.min(100, marker))}%` }} title="Time elapsed" />}
    </div>
  )
}

function Stat({ label, value, sub, tone, trend, href }) {
  const body = (
    <>
      <div className="ins-stat-label">
        {tone && <span className={`ins-stat-dot ins-stat-dot--${tone}`} aria-hidden="true" />}
        {label}
      </div>
      <div className="ins-stat-row">
        <div className="ins-stat-value">{value}</div>
        {trend}
      </div>
      {sub && <div className="ins-stat-sub">{sub}</div>}
    </>
  )
  return href ? <Link href={href} className="ins-stat ins-stat--link">{body}</Link> : <div className="ins-stat">{body}</div>
}

function Card({ title, sub, count, tone, action, children, className = '' }) {
  return (
    <section className={`ins-card ${className}`}>
      <div className="ins-card-head">
        <span className="ins-card-title">{title}{sub && <span className="ins-card-sub">{sub}</span>}</span>
        {count != null && <span className={`ins-count${tone && count > 0 ? ` ins-count--${tone}` : ''}`}>{count}</span>}
        {action && <span className="ins-card-action">{action}</span>}
      </div>
      <div className="ins-card-body">{children}</div>
    </section>
  )
}

// One task line that opens the task where it lives.
function TaskLine({ slug, item, right }) {
  const href = `/projects/${slug}/tasks?${item.version ? `version=${encodeURIComponent(item.version)}&` : ''}task=${encodeURIComponent(item.id)}`
  return (
    <Link href={href} className="ins-line">
      <span className="ins-line-main">
        <span className="ins-line-title">
          {item.number && <span className="ins-line-id">{item.number}</span>}
          {item.title || 'Untitled'}
        </span>
        <span className="ins-line-meta">
          {item.isStory ? 'Story' : 'Sub-task'} · {item.assignees.length ? item.assignees.join(', ') : 'No owner'}
        </span>
      </span>
      {right}
    </Link>
  )
}

function ShowMore({ list, limit, render }) {
  const [all, setAll] = useState(false)
  const shown = all ? list : list.slice(0, limit)
  return (
    <>
      {shown.map(render)}
      {list.length > limit && (
        <button type="button" className="ins-more" onClick={() => setAll(v => !v)}>
          {all ? 'Show less' : `Show ${list.length - limit} more`}
        </button>
      )}
    </>
  )
}

function sprintHealth(s) {
  if (s.daysLeft != null && s.daysLeft < 0) return { label: 'Past end date', tone: 'red' }
  if (s.tasks === 0) return { label: 'No work planned', tone: 'muted' }
  if (s.startsIn > 0) return { label: `Starts in ${s.startsIn}d`, tone: 'muted' }
  if (s.timePct == null) return null
  const gap = s.timePct - s.pct
  if (gap <= 10) return { label: 'On track', tone: 'green' }
  if (gap <= 30) return { label: 'Slightly behind', tone: 'amber' }
  return { label: 'Behind', tone: 'red' }
}

function daysLeftText(d) {
  if (d == null) return ''
  if (d < 0) return `Ended ${-d}d ago`
  if (d === 0) return 'Last day'
  return `${d} day${d === 1 ? '' : 's'} left`
}

export default function ProjectInsights() {
  const router = useRouter()
  const { slug } = router.query
  const columns = useColumns(slug)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('overdue')

  useEffect(() => {
    if (!slug) return
    setLoading(true)
    apiFetch(`/api/projects/${slug}/dashboard`)
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setError(String(e)); setLoading(false) })
  }, [slug])

  if (loading) return (
    <>
      <Nav />
      <main className="page page--full">
        <span className="skeleton ins-skel-title" />
        <div className="ins-top">{[0, 1, 2, 3, 4].map(i => <span key={i} className="skeleton ins-skel-stat" />)}</div>
        <div className="ins-layout">{[0, 1, 2, 3].map(i => <span key={i} className="skeleton ins-skel-card" />)}</div>
      </main>
    </>
  )

  if (error || !data) return (
    <>
      <Nav />
      <main className="page page--full">
        <div className="empty-state">{error === '404' ? 'Project not found.' : error === '403' ? 'You do not have access to Insights for this project.' : 'Could not load Insights.'}</div>
      </main>
    </>
  )

  const { project, stories, tasks, sprint, history, velocity, epics, overdue, upcoming, slipping, workload, can, qa } = data
  const health = sprint && sprintHealth(sprint)

  // Pipeline in board order; any status without a column still shows.
  const colOf = Object.fromEntries(columns.map(c => [c.status, c]))
  const order = [...columns.map(c => c.status), ...Object.keys(stories.byStatus).filter(s => !colOf[s])]
  const pipeline = order.filter(s => stories.byStatus[s]).map(s => ({
    key: s,
    label: colOf[s]?.label || labelForStatus(s),
    color: colOf[s]?.color || '#94a3b8',
    count: stories.byStatus[s],
  }))

  const loadMax = Math.max(1, ...workload.map(w => w.open))
  const velTrend = velocity && velocity.prev != null ? velocity.last - velocity.prev : null
  const attention = { overdue, upcoming, slipping }
  const firstPassPct = qa && qa.passed ? Math.round((qa.firstPass / qa.passed) * 100) : null

  return (
    <>
      <Nav projectName={project.name} />
      <main className="page page--full ins-page">
        <PageHeader title="Insights" subtitle="How the project is going, and what needs attention." />

        {/* 1 — At a glance: one hero figure, then the four signals that move it */}
        <div className="ins-top">
          <section className="ins-hero">
            <div className="ins-stat-label">Project progress</div>
            <div className="ins-hero-value">{stories.pct}<span>%</span></div>
            <div className="ins-meter" role="img" aria-label={`${stories.pct}% of stories done`}>
              <span style={{ width: `${stories.pct}%` }} />
            </div>
            <div className="ins-stat-sub">{stories.done} of {stories.total} stories done · {tasks.done} of {tasks.total} tasks</div>
          </section>
          {can.sprints && (
            <Stat
              label="Sprint"
              value={sprint ? `${sprint.pct}%` : '—'}
              tone={health?.tone}
              sub={sprint ? <>{health?.label || sprint.name} · {sprint.startsIn > 0 ? `starts in ${sprint.startsIn}d` : daysLeftText(sprint.daysLeft)}</> : 'No sprint running'}
              href={`/projects/${slug}/sprints`}
            />
          )}
          {can.sprints && (
            <Stat
              label="Velocity"
              value={velocity ? velocity.avg : '—'}
              trend={<Sparkline values={history.map(h => h.completedPoints)} label="Points done per sprint" />}
              sub={velocity
                ? <>pts / sprint{velTrend != null && <> · <span className={velTrend >= 0 ? 'ins-delta-up' : 'ins-delta-down'}>{velTrend >= 0 ? '▲' : '▼'} {Math.abs(velTrend)}</span> vs previous</>}</>
                : 'After the first completed sprint'}
            />
          )}
          <Stat
            label="Overdue"
            value={overdue.length}
            tone={overdue.length ? 'red' : 'green'}
            sub={overdue.length ? `${upcoming.length} more due this week` : upcoming.length ? `Nothing late · ${upcoming.length} due this week` : 'Nothing late'}
          />
          {qa && (
            <Stat
              label="QA queue"
              value={qa.waiting}
              tone={qa.rework ? 'amber' : null}
              sub={`${qa.rework} in rework · ${qa.passed} passed (30d)`}
              href={`/projects/${slug}/qa`}
            />
          )}
        </div>

        <div className="ins-layout">
          <div className="ins-col">
            {/* 2 — Current sprint */}
            {can.sprints && (
              <Card
                title="Current sprint"
                sub={sprint ? sprint.name : null}
                action={<Link href={`/projects/${slug}/sprints`} className="ins-link">Open sprint</Link>}
              >
                {!sprint ? (
                  <div className="empty-state-sm">No sprint is running. Plan one from the backlog.</div>
                ) : (
                  <div className="ins-sprint">
                    <div className="ins-sprint-head">
                      {health && <span className={`ins-pill ins-pill--${health.tone}`}>{health.label}</span>}
                      <span className="ins-sprint-dates">
                        {fmtDate(sprint.startDate)}{sprint.startDate && sprint.endDate && ' – '}{fmtDate(sprint.endDate)}
                        {sprint.daysLeft != null && <> · {daysLeftText(sprint.daysLeft)}</>}
                      </span>
                    </div>
                    {sprint.goal && <div className="ins-sprint-goal">{sprint.goal}</div>}
                    {sprint.burndown && sprint.burndown.total > 0 ? (
                      <>
                        <div className="chart-legend">
                          <span><i className="chart-key chart-key--blue" />Points remaining</span>
                          <span><i className="chart-key chart-key--ideal" />Ideal</span>
                        </div>
                        <Burndown data={sprint.burndown} />
                      </>
                    ) : (
                      <Bar pct={sprint.pct} tone={health?.tone} marker={sprint.timePct} />
                    )}
                    <div className="ins-mini-stats">
                      <div><strong>{sprint.storiesDone}/{sprint.stories}</strong><span>stories</span></div>
                      <div><strong>{sprint.tasksDone}/{sprint.tasks}</strong><span>tasks</span></div>
                      <div>
                        <strong className={sprint.capacity && sprint.points > sprint.capacity ? 'ins-tone--red' : ''}>
                          {sprint.pointsDone}/{sprint.points}
                        </strong>
                        <span>{sprint.capacity ? `pts · cap ${sprint.capacity}` : 'points'}</span>
                      </div>
                      <div><strong>{sprint.timePct ?? '—'}{sprint.timePct != null && '%'}</strong><span>time used</span></div>
                      <div><strong className={sprint.carriedIn ? 'ins-tone--amber' : ''}>{sprint.carriedIn}</strong><span>carried in</span></div>
                    </div>
                    {sprint.unassigned.length > 0 && (
                      <div className="ins-sub-list">
                        <div className="ins-sub-head">No owner yet ({sprint.unassigned.length})</div>
                        <ShowMore list={sprint.unassigned} limit={3} render={t => <TaskLine key={t.id} slug={slug} item={t} />} />
                      </div>
                    )}
                  </div>
                )}
              </Card>
            )}

            {/* 4 — Sprint history */}
            {can.sprints && (
              <Card title="Sprint history" sub="stories committed vs done">
                {history.length === 0 ? (
                  <div className="empty-state-sm">Completed sprints will show here.</div>
                ) : (
                  <>
                    <div className="chart-legend">
                      <span><i className="chart-key chart-key--bar-orange" />Committed</span>
                      <span><i className="chart-key chart-key--bar-blue" />Done</span>
                    </div>
                    <HistoryColumns history={history} />
                    <table className="ins-table">
                      <thead><tr><th>Sprint</th><th>Done</th><th>Committed</th><th>Carried</th><th>Points</th></tr></thead>
                      <tbody>
                        {[...history].reverse().map(h => (
                          <tr key={h.id}>
                            <td>{h.name}</td>
                            <td>{h.completed}</td>
                            <td>{h.committed + h.added}</td>
                            <td className={h.carried ? 'ins-tone--amber' : ''}>{h.carried}</td>
                            <td>{h.completedPoints}/{h.totalPoints}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </Card>
            )}

            {/* 6 — Needs attention */}
            <Card title="Needs attention" count={overdue.length + slipping.length} tone="red">
              <div className="ins-tabs" role="tablist">
                {[['overdue', 'Overdue', overdue.length], ['upcoming', 'Due in 7 days', upcoming.length], ['slipping', 'Keeps slipping', slipping.length]].map(([k, l, n]) => (
                  <button key={k} type="button" role="tab" aria-selected={tab === k} className={`ins-tab${tab === k ? ' is-on' : ''}`} onClick={() => setTab(k)}>
                    {l}<span className="ins-tab-n">{n}</span>
                  </button>
                ))}
              </div>
              {attention[tab].length === 0 ? (
                <div className="empty-state-sm">
                  {tab === 'overdue' ? 'Nothing is overdue.' : tab === 'upcoming' ? 'Nothing due in the next 7 days.' : 'No story has been carried over twice or more.'}
                </div>
              ) : (
                <ShowMore
                  key={tab}
                  list={attention[tab]}
                  limit={6}
                  render={t => (
                    <TaskLine
                      key={t.id}
                      slug={slug}
                      item={t}
                      right={
                        tab === 'overdue' ? <span className="ins-pill ins-pill--red">{t.daysOverdue}d late</span>
                        : tab === 'upcoming' ? <span className={`ins-pill ins-pill--${t.daysUntil <= 1 ? 'amber' : 'muted'}`}>{t.daysUntil === 0 ? 'Today' : t.daysUntil === 1 ? 'Tomorrow' : fmtDate(t.dueDate)}</span>
                        : <span className="ins-pill ins-pill--amber">{t.carryOver}× carried</span>
                      }
                    />
                  )}
                />
              )}
            </Card>

          </div>
          <div className="ins-col">
            {/* 3 — Story pipeline */}
            <Card title="Story pipeline" count={stories.total}>
              {stories.total === 0 ? (
                <div className="empty-state-sm">No stories yet.</div>
              ) : (
                <>
                  <StackBar parts={pipeline} total={stories.total} label="Stories by status" />
                  <ul className="ins-pipe">
                    {pipeline.map(p => (
                      <li key={p.key} style={{ '--status-color': p.color }}>
                        <span className="ins-dot" />
                        <span className="ins-pipe-label">{p.label}</span>
                        <span className="ins-pipe-bar"><span style={{ width: `${(p.count / stories.total) * 100}%` }} /></span>
                        <strong>{p.count}</strong>
                        <span className="ins-pipe-pct">{Math.round((p.count / stories.total) * 100)}%</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Card>

            {/* 5 — QA review */}
            {qa && (
              <Card title="QA review" action={<Link href={`/projects/${slug}/qa`} className="ins-link">Open QA board</Link>}>
                <div className="ins-qa">
                  <div><strong>{qa.waiting}</strong><span>waiting</span></div>
                  <div><strong className={qa.rework ? 'ins-tone--amber' : ''}>{qa.rework}</strong><span>in rework</span></div>
                  <div><strong>{qa.passed}</strong><span>passed, 30 days</span></div>
                </div>
                <div className="ins-qa-rate">
                  <div className="ins-qa-rate-head">
                    <span>First-time pass rate</span>
                    <strong>{firstPassPct == null ? '—' : `${firstPassPct}%`}</strong>
                  </div>
                  <div className="ins-meter" role="img" aria-label={firstPassPct == null ? 'No stories passed yet' : `${firstPassPct}% passed QA first time`}>
                    <span style={{ width: `${firstPassPct || 0}%` }} />
                  </div>
                  <div className="ins-stat-sub">
                    {qa.passed
                      ? `${qa.firstPass} of ${qa.passed} passed without rework · ${qa.reworkRounds} rework round${qa.reworkRounds === 1 ? '' : 's'} in total`
                      : 'Shows once stories pass QA.'}
                  </div>
                </div>
                {qa.oldest && (
                  <div className="ins-sub-list">
                    <div className="ins-sub-head">Waiting longest</div>
                    <TaskLine slug={slug} item={qa.oldest} right={qa.oldest.since && <span className="ins-pill ins-pill--muted">{ago(qa.oldest.since)}</span>} />
                  </div>
                )}
              </Card>
            )}

            {/* 7 — Workload: open work per person, the late part stacked at the end */}
            <Card title="Workload" sub="open tasks per person">
              {workload.length === 0 ? (
                <div className="empty-state-sm">Nobody has open work assigned.</div>
              ) : (
                <>
                  <div className="chart-legend">
                    <span><i className="chart-key chart-key--bar-blue" />On time</span>
                    <span><i className="chart-key chart-key--bar-crit" />Late</span>
                  </div>
                  <ShowMore
                    list={workload}
                    limit={8}
                    render={w => (
                      <div key={w.assignee} className="ins-load" title={`${w.assignee}: ${w.open} open, ${w.overdue} late`}>
                        <PersonLink name={w.assignee} className="ins-load-name" />
                        <div className="ins-load-track">
                          <div className="ins-load-bar" style={{ width: `${(w.open / loadMax) * 100}%` }}>
                            {w.open - w.overdue > 0 && <span className="ins-load-seg ins-load-seg--ok" style={{ flexGrow: w.open - w.overdue }} />}
                            {w.overdue > 0 && <span className="ins-load-seg ins-load-seg--late" style={{ flexGrow: w.overdue }} />}
                          </div>
                        </div>
                        <span className="ins-load-num">
                          {w.open}
                          {w.overdue > 0 && <span className="ins-load-late"> · {w.overdue} late</span>}
                        </span>
                      </div>
                    )}
                  />
                </>
              )}
            </Card>

          </div>
          {/* 8 — Epics */}
          {can.epics && (
            <Card className="ins-span-12" title="Epics in progress" count={epics.length} action={<Link href={`/projects/${slug}/epics`} className="ins-link">All epics</Link>}>
              {epics.length === 0 ? (
                <div className="empty-state-sm">No open epics.</div>
              ) : (
                <div className="ins-epics">
                  {epics.map(e => (
                    <div key={e.id} className="ins-epic" style={e.color ? { '--status-color': e.color } : undefined}>
                      <div className="ins-epic-head">
                        <span className="ins-dot" />
                        <span className="ins-epic-name">{e.name}</span>
                        <strong className="ins-epic-pct">{e.pct}%</strong>
                      </div>
                      <Bar pct={e.pct} tone={e.late ? 'red' : null} />
                      <div className="ins-epic-meta">
                        <span>{e.storiesDone} of {e.stories} stories</span>
                        <span className={e.late ? 'ins-tone--red' : ''}>{e.targetDate ? `${e.late ? 'Was due' : 'Due'} ${fmtDate(e.targetDate)}` : 'No target date'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>
      </main>
    </>
  )
}

function ago(iso) {
  const t = Date.parse(iso || '')
  if (!t) return ''
  const h = Math.round((Date.now() - t) / 3600000)
  if (h < 1) return 'under 1h'
  if (h < 24) return `${h}h`
  return `${Math.round(h / 24)}d`
}
