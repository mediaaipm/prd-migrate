import { useState, useEffect, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from '../lib/router-compat'
import Nav from '../components/Nav'
import PageHeader from '../components/PageHeader'
import PersonLink from '../components/PersonLink'
import { apiFetch } from '../lib/api-fetch'
import { onSync } from '../lib/submit-queue'
import { DEFAULT_COLUMNS, labelForStatus } from '../lib/kanban-columns'
import { roleLabel } from '../lib/roles'

// My tasks — everything assigned to the signed-in account, across every project it can
// see (GET /api/my-tasks). Open work is grouped by when it is due; Done shows the last
// 30 days. A row opens the task in its project.
//
// My team (`?view=team`, shown to anyone with people reporting to them — lib/team.js):
// the same lists for the whole team, grouped by person, limited to projects the lead
// can see. Managers get every team, with a Team filter. The server decides who is on it.
const TABS = [
  { key: 'open', label: 'Open' },
  { key: 'done', label: 'Done' },
]
const PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 }
const PRIORITY_LABEL = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' }

function dayStart(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime() }
function parseDue(v) { if (!v) return null; const t = Date.parse(String(v).length === 10 ? `${v}T00:00:00` : v); return Number.isNaN(t) ? null : dayStart(t) }

function bucketOf(item, today) {
  const due = parseDue(item.dueDate)
  if (due == null) return 'none'
  if (due < today) return 'overdue'
  if (due === today) return 'today'
  if (due <= today + 7 * 86400000) return 'week'
  return 'later'
}
const BUCKETS = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Due today' },
  { key: 'week', label: 'Next 7 days' },
  { key: 'later', label: 'Later' },
  { key: 'none', label: 'No due date' },
]

function shortDate(v) {
  const t = parseDue(v)
  if (t == null) return ''
  const d = new Date(t)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })
}

export function taskHref(item) {
  return `/projects/${item.project}/tasks?${item.version ? `version=${encodeURIComponent(item.version)}&` : ''}task=${encodeURIComponent(item.id)}`
}

export function Row({ item, project, today }) {
  const cols = project?.columns || DEFAULT_COLUMNS
  const col = cols.find(c => c.status === item.status)
  const id = item.seq != null ? (project?.prefix ? `${project.prefix}-${item.seq}` : `#${item.seq}`) : ''
  const due = parseDue(item.dueDate)
  const tone = item.status === 'done' || due == null ? '' : due < today ? ' my-due--late' : due <= today + 2 * 86400000 ? ' my-due--soon' : ''
  return (
    <li className={`my-row${item.status === 'done' ? ' my-row--done' : ''}`}>
      <span className="my-status" style={{ '--status-color': col?.color || '#94a3b8' }}>{col?.label || labelForStatus(item.status)}</span>
      <div className="my-main">
        <Link href={taskHref(item)} className="my-title">
          {id && <span className="my-id">{id}</span>}
          <span className="my-title-text">{item.title}</span>
        </Link>
        <div className="my-meta">
          <span className="my-project">{project?.name || item.project}</span>
          {item.story && <span className="my-story" title="Story">› {item.story.title}</span>}
          {item.version && <span className="my-version">v{item.version}</span>}
          {item.qaNote && <span className="my-qa-note" title={item.qaNote}>↩ QA: {item.qaNote}</span>}
        </div>
      </div>
      <span className={`my-priority my-priority--${item.priority || 'none'}`}>{PRIORITY_LABEL[item.priority] || ''}</span>
      <span className="my-pts">{item.points != null ? `${item.points} pt${item.points === 1 ? '' : 's'}` : ''}</span>
      <span className={`my-due${tone}`}>{shortDate(item.dueDate)}</span>
    </li>
  )
}

const byDue = (a, b) =>
  (parseDue(a.dueDate) ?? Infinity) - (parseDue(b.dueDate) ?? Infinity) ||
  (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) ||
  a.title.localeCompare(b.title)

export default function MyTasks({ currentUser }) {
  const router = useRouter()
  const tab = router.query.tab === 'done' ? 'done' : 'open'
  const view = router.query.view === 'team' ? 'team' : 'mine'
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [project, setProject] = useState('')
  const [person, setPerson] = useState('')
  const [lead, setLead] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/my-tasks${view === 'team' ? '?view=team' : ''}`)
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setError(d.error || 'Could not load tasks.'); return }
      setError(''); setData(d)
    } catch {
      setError('Could not load tasks.')
    }
  }, [view])
  useEffect(() => { if (currentUser) { setData(null); load() } }, [currentUser, load])
  useEffect(() => onSync(load), [load])
  // Teams page links here with ?lead= / ?person= preselected.
  useEffect(() => {
    setLead(typeof router.query.lead === 'string' ? router.query.lead : '')
    setPerson(typeof router.query.person === 'string' ? router.query.person : '')
  }, [view, router.query.lead, router.query.person])

  const projects = useMemo(() => new Map((data?.projects || []).map(p => [p.slug, p])), [data])
  const team = data?.team || []
  const today = dayStart(Date.now())
  const isTeam = view === 'team' && data?.view === 'team'
  // Managers see every team (lib/team.js) — let them narrow to one lead's team.
  const leads = useMemo(() => [...new Set(team.map(m => m.lead).filter(Boolean))].sort(), [team])
  const inTeam = m => !lead || m.lead === lead || m.name === lead
  const shown = useMemo(() => new Set(team.filter(inTeam).map(m => m.name)), [team, lead]) // eslint-disable-line react-hooks/exhaustive-deps

  const items = useMemo(() => {
    const term = q.trim().toLowerCase()
    return (data?.[tab] || []).filter(i =>
      (!project || i.project === project) &&
      (!person || i.assignees.includes(person)) &&
      (!isTeam || !lead || i.assignees.some(a => shown.has(a))) &&
      (!term || i.title.toLowerCase().includes(term) || (i.story?.title || '').toLowerCase().includes(term)))
  }, [data, tab, q, project, person, isTeam, lead, shown])

  const groups = useMemo(() => {
    if (isTeam) {
      // One section per team member — a task shared by two of them shows under both.
      // Members with nothing open still get a section, so the lead sees who is free.
      const members = team.filter(m => (!person || m.name === person) && inTeam(m))
      return members.map(m => {
        const mine = items.filter(i => i.assignees.includes(m.name))
        mine.sort(tab === 'done' ? () => 0 : byDue)
        return {
          key: `p:${m.name}`, member: m, items: mine,
          overdue: tab === 'open' ? mine.filter(i => bucketOf(i, today) === 'overdue').length : 0,
        }
      }).filter(g => g.items.length || (!q && !project && tab === 'open'))
    }
    if (tab === 'done') return [{ key: 'done', label: `Done in the last ${data?.doneDays || 30} days`, items }]
    const sorted = [...items].sort(byDue)
    return BUCKETS.map(b => ({ ...b, items: sorted.filter(i => bucketOf(i, today) === b.key) })).filter(g => g.items.length)
  }, [items, tab, today, data, isTeam, team, person, q, project, lead]) // eslint-disable-line react-hooks/exhaustive-deps

  const counts = data ? { open: data.open.length, done: data.done.length } : null
  const overdue = data ? data.open.filter(i => bucketOf(i, today) === 'overdue').length : 0
  const rework = data ? data.open.filter(i => i.status === 'need-rework').length : 0
  const hasTeam = team.length > 0

  function go(next) {
    const qs = new URLSearchParams()
    if ((next.view ?? view) === 'team') qs.set('view', 'team')
    if ((next.tab ?? tab) === 'done') qs.set('tab', 'done')
    const s = qs.toString()
    router.push(`/my-tasks${s ? `?${s}` : ''}`)
  }

  const viewSwitch = (hasTeam || view === 'team') && (
    <div className="my-view-switch" role="tablist" aria-label="Whose tasks">
      <button role="tab" aria-selected={view === 'mine'} className={view === 'mine' ? 'is-on' : ''} onClick={() => go({ view: 'mine' })}>Mine</button>
      <button role="tab" aria-selected={view === 'team'} className={view === 'team' ? 'is-on' : ''} onClick={() => go({ view: 'team' })}>
        My team{hasTeam && <span className="my-view-count">{team.length}</span>}
      </button>
    </div>
  )

  return (
    <>
      <Nav />
      <main className="page page--full">
        <PageHeader
          title={view === 'team' ? 'My team' : 'My tasks'}
          subtitle={view === 'team'
            ? (currentUser?.role === 'manager'
              ? 'Every team\'s tasks, in the projects you can see.'
              : 'Tasks assigned to the people who report to you, in the projects you can see.')
            : 'Everything assigned to you, across all your projects.'}
          actions={viewSwitch}
        />

        {data && tab === 'open' && (overdue > 0 || rework > 0) && (
          <div className="my-alerts">
            {overdue > 0 && <span className="my-alert my-alert--late">{overdue} overdue</span>}
            {rework > 0 && <span className="my-alert my-alert--rework">{rework} sent back by QA</span>}
          </div>
        )}

        <div className="my-toolbar">
          <div className="epic-filters my-tabs" role="tablist">
            {TABS.map(t => (
              <button key={t.key} role="tab" aria-selected={tab === t.key} className={`epic-filter${tab === t.key ? ' is-on' : ''}`} onClick={() => go({ tab: t.key })}>
                {t.label}
                {counts && <span className="epic-filter-count">{counts[t.key]}</span>}
              </button>
            ))}
          </div>
          <div className="my-filters">
            <input className="my-search" type="search" placeholder="Search tasks" value={q} onChange={e => setQ(e.target.value)} aria-label="Search tasks" />
            {isTeam && leads.length > 1 && (
              <select className="my-project-select" value={lead} onChange={e => { setLead(e.target.value); setPerson('') }} aria-label="Team">
                <option value="">All teams</option>
                {leads.map(l => <option key={l} value={l}>{l}'s team</option>)}
              </select>
            )}
            {isTeam && team.length > 1 && (
              <select className="my-project-select" value={person} onChange={e => setPerson(e.target.value)} aria-label="Person">
                <option value="">Everyone</option>
                {team.filter(inTeam).map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
              </select>
            )}
            {(data?.projects || []).length > 1 && (
              <select className="my-project-select" value={project} onChange={e => setProject(e.target.value)} aria-label="Project">
                <option value="">All projects</option>
                {data.projects.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}
              </select>
            )}
          </div>
        </div>

        {error && <div className="kanban-col-error">{error}</div>}
        {!data && !error && <div className="section-card epic-empty">Loading…</div>}
        {data && view === 'team' && !hasTeam && (
          <div className="section-card epic-empty">{currentUser?.role === 'manager' ? 'No teams are set up yet.' : 'Nobody reports to you yet.'} An admin or manager sets each person's team lead under Admin → Users.</div>
        )}
        {data && (view === 'mine' || hasTeam) && groups.length === 0 && (
          <div className="section-card epic-empty">
            {q || project || person ? 'No tasks match.' : tab === 'open' ? (view === 'team' ? 'Your team has nothing open.' : 'Nothing assigned to you right now.') : 'Nothing finished recently.'}
          </div>
        )}

        {groups.map(g => (
          <section key={g.key} className={`my-group my-group--${g.member ? 'person' : g.key}`}>
            {g.member ? (
              <h2 className="my-group-head my-person-head">
                <span className="my-person-avatar" aria-hidden="true">{g.member.name.charAt(0).toUpperCase()}</span>
                <PersonLink name={g.member.name} className="my-person-name" />
                <span className="my-person-role">{roleLabel(g.member.role)}{!g.member.direct && g.member.lead ? <> · reports to <PersonLink name={g.member.lead} /></> : ''}</span>
                <span className="my-group-count">{g.items.length} {tab === 'done' ? 'done' : 'open'}</span>
                {g.overdue > 0 && <span className="my-person-late">{g.overdue} overdue</span>}
              </h2>
            ) : (
              <h2 className="my-group-head">{g.label}<span className="my-group-count">{g.items.length}</span></h2>
            )}
            {g.items.length > 0 ? (
              <ul className="my-list">
                {g.items.map(i => <Row key={`${i.project}:${i.version || ''}:${i.id}`} item={i} project={projects.get(i.project)} today={today} />)}
              </ul>
            ) : (
              <div className="my-person-empty">No open tasks.</div>
            )}
          </section>
        ))}
      </main>
    </>
  )
}
