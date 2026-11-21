import { useCallback, useEffect, useMemo, useState } from 'react'
import { assigneesUrl, accessUrl } from '../../../lib/config-cache'
import { useRouter } from '../../../lib/router-compat'
import Link from 'next/link'
import Nav from '../../../components/Nav'
import PageHeader from '../../../components/PageHeader'
import TaskForm, { blankForm } from '../../../components/TaskForm'
import { apiFetch } from '../../../lib/api-fetch'
import { useColumns } from '../../../lib/kanban-columns'
import { scopeUserToProject } from '../../../lib/scoped-user'
import { hasPerm, isNestingCapped } from '../../../lib/client-permissions'
import { useEpics, epicMap, setStoryEpic, updateStory, notifyEpicsChanged } from '../../../lib/epics'
import { useSprints, addStoriesToSprint } from '../../../lib/sprints'

// The backlog: every story (root task) still in the `backlog` status, across all
// versions, grouped by epic. New stories land here — the task POST defaults a root
// task to `backlog` — and leave it when someone moves them to To Do (or drags them
// on the board). Sub-tasks are not listed; they follow their story.

const PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 }
const NO_EPIC = '__none'

function storyHref(slug, story) {
  const q = new URLSearchParams({ task: story.id })
  if (story.version) q.set('version', story.version)
  return `/projects/${slug}/tasks?${q}`
}

export default function ProjectBacklog({ currentUser }) {
  const router = useRouter()
  const { slug } = router.query
  const [projectName, setProjectName] = useState('')
  const [access, setAccess] = useState(null)
  const [tasks, setTasks] = useState(null)
  const [labels, setLabels] = useState([])
  const [assignees, setAssignees] = useState([])
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const [epicFilter, setEpicFilter] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')
  const savedColumns = useColumns(slug)
  const { epics } = useEpics(slug)
  const epicsById = useMemo(() => epicMap(epics), [epics])
  // Planned/active sprints a story can be planned into. Admin-only (project:update).
  const { sprints, canManage: canPlan } = useSprints(slug)
  const openSprints = sprints.filter(s => s.status !== 'completed')

  const load = useCallback(() => {
    if (!slug) return Promise.resolve()
    return apiFetch(`/api/projects/${slug}/tasks?allVersions=1`)
      .then(r => (r.ok ? r.json() : null))
      .then(list => { if (Array.isArray(list)) setTasks(list) })
      .catch(() => {})
  }, [slug])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!router.isReady || !slug) return
    apiFetch(`/api/projects/${slug}`).then(r => (r.ok ? r.json() : null)).then(p => p && setProjectName(p.name || '')).catch(() => {})
    apiFetch(accessUrl(slug)).then(r => (r.ok ? r.json() : null)).then(setAccess).catch(() => {})
    apiFetch(`/api/projects/${slug}/labels`).then(r => (r.ok ? r.json() : [])).then(l => setLabels(Array.isArray(l) ? l : [])).catch(() => {})
    apiFetch(assigneesUrl()).then(r => (r.ok ? r.json() : [])).then(a => setAssignees(Array.isArray(a) ? a : [])).catch(() => {})
  }, [router.isReady, slug])

  const scopedUser = useMemo(() => scopeUserToProject(currentUser, access), [currentUser, access])
  // A story is a root task, which a nesting-capped account may not create.
  const canCreate = hasPerm(scopedUser, 'task:create') && !isNestingCapped(scopedUser)
  const canEdit = hasPerm(scopedUser, 'task:update')
  const hasTodo = savedColumns.some(c => c.status === 'todo')

  // Sub-task counts per story, within the story's own version list.
  const subCount = useMemo(() => {
    const out = {}
    const byKey = {}
    for (const t of (tasks || [])) byKey[`${t.version || ''}:${t.id}`] = t
    for (const t of (tasks || [])) {
      if (!t.parentId || t.archived) continue
      let cur = t
      const seen = new Set()
      while (cur && cur.parentId && !seen.has(cur.id)) { seen.add(cur.id); cur = byKey[`${t.version || ''}:${cur.parentId}`] }
      if (cur && !cur.parentId) out[`${t.version || ''}:${cur.id}`] = (out[`${t.version || ''}:${cur.id}`] || 0) + 1
    }
    return out
  }, [tasks])

  const stories = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (tasks || [])
      .filter(t => !t.parentId && !t.archived && t.status === 'backlog')
      .filter(t => !q || `${t.number} ${t.title}`.toLowerCase().includes(q))
      .filter(t => !epicFilter || (epicFilter === NO_EPIC ? !t.epicId || !epicsById[t.epicId] : t.epicId === epicFilter))
      .sort((a, b) => (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2) || String(a.createdAt).localeCompare(String(b.createdAt)))
  }, [tasks, query, epicFilter, epicsById])

  // Epic groups in the epics' own order, then "No epic" last.
  const groups = useMemo(() => {
    const byEpic = {}
    for (const s of stories) {
      const key = s.epicId && epicsById[s.epicId] ? s.epicId : NO_EPIC
      ;(byEpic[key] = byEpic[key] || []).push(s)
    }
    const out = epics.filter(e => byEpic[e.id]).map(e => ({ key: e.id, epic: e, items: byEpic[e.id] }))
    if (byEpic[NO_EPIC]) out.push({ key: NO_EPIC, epic: null, items: byEpic[NO_EPIC] })
    return out
  }, [stories, epics, epicsById])

  async function act(story, fn) {
    setBusyId(story.id); setError('')
    try { await fn(); await load() } catch (e) { setError(e.message) }
    setBusyId(null)
  }

  async function addStory(form, opts = {}) {
    setError('')
    const body = {
      ...form,
      parentId: null,
      category: form.category || null,
      epicId: form.epicId || null,
      startDate: form.startDate || null,
      dueDate: form.dueDate || null,
      numberOverride: form.numberOverride || null,
      points: form.points === '' || form.points == null ? null : Number(form.points),
    }
    const res = await apiFetch(`/api/projects/${slug}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error || 'Could not add the story.'); return }
    if (!opts.keepOpen) setAdding(false)
    if (body.epicId) notifyEpicsChanged(slug)
    load()
  }

  const total = (tasks || []).filter(t => !t.parentId && !t.archived && t.status === 'backlog').length

  return (
    <>
      <Nav projectName={projectName} />
      <main className="page page--full">
        <PageHeader
          title="Backlog"
          subtitle="New stories land here. Link each one to an epic and plan it into a sprint when it's ready."
          actions={canCreate && !adding && <button className="btn-primary" onClick={() => setAdding(true)}>+ New Story</button>}
        />

        {adding && (
          <div className="section-card backlog-add">
            <TaskForm
              initial={{ ...blankForm(), status: 'backlog' }}
              onSave={addStory}
              onCancel={() => setAdding(false)}
              label="Add Story"
              titlePlaceholder="Story title *"
              assignees={assignees}
              showCreator
              currentUser={currentUser}
              allowAddAnother
              columns={savedColumns}
              labels={labels}
              requireLabel
              epics={epics}
              showEpic
            />
          </div>
        )}

        <div className="backlog-toolbar">
          <input className="form-input backlog-search" placeholder="Search backlog…" value={query} onChange={e => setQuery(e.target.value)} />
          <select className="form-input backlog-epic-filter" value={epicFilter} onChange={e => setEpicFilter(e.target.value)} title="Filter by epic">
            <option value="">All epics</option>
            {epics.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            <option value={NO_EPIC}>No epic</option>
          </select>
          <span className="epic-muted">{stories.length} of {total} stories</span>
        </div>

        {error && <div className="kanban-col-error">{error}</div>}
        {tasks === null && <div className="epic-muted">Loading backlog…</div>}
        {tasks && groups.length === 0 && (
          <div className="section-card epic-empty">
            {total === 0 ? 'The backlog is empty.' : 'No stories match these filters.'}
          </div>
        )}

        {groups.map(g => (
          <section key={g.key} className="section-card backlog-group" style={{ '--status-color': g.epic?.color || '#94a3b8' }}>
            <div className="backlog-group-head">
              <span className="epic-dot" />
              {g.epic
                ? <Link href={`/projects/${slug}/epics?epic=${encodeURIComponent(g.epic.id)}`} className="backlog-group-name">{g.epic.name}</Link>
                : <span className="backlog-group-name">No epic</span>}
              <span className="epic-filter-count">{g.items.length}</span>
            </div>
            {g.items.map(s => {
              const subs = subCount[`${s.version || ''}:${s.id}`] || 0
              return (
                <div key={`${s.version || ''}:${s.id}`} className="backlog-row">
                  <span className={`backlog-priority backlog-priority--${s.priority || 'medium'}`} title={`${s.priority || 'medium'} priority`} />
                  <span className="task-number">{s.number}</span>
                  <Link href={storyHref(slug, s)} className="backlog-title">{s.title}</Link>
                  {s.version && <span className="epic-version">v{s.version}</span>}
                  {Number(s.carryOver) > 0 && (
                    <span className={`carry-badge${s.carryOver > 1 ? ' carry-badge--hot' : ''}`} title={`Carried over from ${s.carryOver} sprint${s.carryOver > 1 ? 's' : ''}`}>↻ {s.carryOver}</span>
                  )}
                  {subs > 0 && <span className="epic-muted">{subs} sub-task{subs === 1 ? '' : 's'}</span>}
                  {canEdit ? (
                    <select
                      className="form-input backlog-epic-select"
                      value={s.epicId && epicsById[s.epicId] ? s.epicId : ''}
                      disabled={busyId === s.id}
                      onChange={e => act(s, () => setStoryEpic(slug, s, e.target.value || null))}
                      title="Epic"
                    >
                      <option value="">No epic</option>
                      {epics.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                    </select>
                  ) : null}
                  {canPlan && openSprints.length > 0 && (
                    <select
                      className="form-input backlog-epic-select"
                      value=""
                      disabled={busyId === s.id}
                      onChange={e => { const id = e.target.value; if (id) act(s, () => addStoriesToSprint(slug, id, [s.id])) }}
                      title="Plan into a sprint — the story moves to To Do"
                    >
                      <option value="">Add to sprint…</option>
                      {openSprints.map(sp => <option key={sp.id} value={sp.id}>{sp.name}{sp.status === 'active' ? ' (active)' : ''}</option>)}
                    </select>
                  )}
                  {canEdit && hasTodo && (
                    <button
                      className="btn-ghost backlog-ready"
                      disabled={busyId === s.id}
                      onClick={() => act(s, () => updateStory(slug, s, { status: 'todo' }))}
                      title="Move to To Do"
                    >
                      → To Do
                    </button>
                  )}
                </div>
              )
            })}
          </section>
        ))}
      </main>
    </>
  )
}
