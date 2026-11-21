import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../lib/api-fetch'
import { useEpics, epicMap } from '../lib/epics'
import { addStoriesToSprint, removeStoriesFromSprint, dateRange, pointsOf, SPRINT_STATUS } from '../lib/sprints'

// Sprint planning: unplanned stories on the left, the chosen sprint on the right.
// Membership is by story — a story's sub-tasks come with it, and its points are the
// whole subtree's. A story already in another open sprint is not offered; one carried
// over keeps its ↻ count so slipping work is visible while planning.

const PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 }

export default function SprintPlanner({ slug, sprints, velocity, canManage, initialSprintId, onCreateSprint }) {
  const open = useMemo(() => sprints.filter(s => s.status !== 'completed'), [sprints])
  const [sprintId, setSprintId] = useState(initialSprintId || '')
  const [tasks, setTasks] = useState(null)
  const [query, setQuery] = useState('')
  const [epicFilter, setEpicFilter] = useState('')
  const [onlyBacklog, setOnlyBacklog] = useState(false)
  const [picked, setPicked] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const { epics } = useEpics(slug)
  const epicsById = useMemo(() => epicMap(epics), [epics])

  // Default to the planned sprint after the active one — that is what gets planned —
  // else the active sprint.
  useEffect(() => {
    if (sprintId && open.some(s => s.id === sprintId)) return
    const planned = open.filter(s => s.status === 'planned')
    setSprintId((planned[0] || open[0])?.id || '')
  }, [open, sprintId])

  const loadTasks = useCallback(() => {
    return apiFetch(`/api/projects/${slug}/tasks?allVersions=1&fields=picker`)
      .then(r => (r.ok ? r.json() : []))
      .then(list => setTasks(Array.isArray(list) ? list.filter(t => !t.archived) : []))
      .catch(() => setTasks([]))
  }, [slug])
  useEffect(() => { loadTasks() }, [loadTasks, sprints])

  // Subtree points per story, within the story's own version list.
  const subtreePoints = useMemo(() => {
    const out = {}
    const byId = {}
    for (const t of tasks || []) byId[t.id] = t
    for (const t of tasks || []) {
      let cur = t
      const seen = new Set()
      while (cur && cur.parentId && !seen.has(cur.id)) { seen.add(cur.id); cur = byId[cur.parentId] }
      if (cur && !cur.parentId) out[cur.id] = (out[cur.id] || 0) + pointsOf(t)
    }
    return out
  }, [tasks])

  const sprint = open.find(s => s.id === sprintId) || null
  const inOpenSprint = useMemo(() => {
    const m = {}
    for (const s of open) for (const id of s.storyIds || []) m[id] = s
    return m
  }, [open])

  const available = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (tasks || [])
      .filter(t => !t.parentId && t.status !== 'done' && !inOpenSprint[t.id])
      .filter(t => !onlyBacklog || t.status === 'backlog')
      .filter(t => !q || `${t.number} ${t.title}`.toLowerCase().includes(q))
      .filter(t => !epicFilter || (epicFilter === '__none' ? !t.epicId : t.epicId === epicFilter))
      .sort((a, b) => (Number(b.carryOver) || 0) - (Number(a.carryOver) || 0)
        || (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2))
  }, [tasks, inOpenSprint, query, epicFilter, onlyBacklog])

  const planned = sprint ? (sprint.stories || []) : []
  const plannedPoints = planned.reduce((n, s) => n + (subtreePoints[s.id] || pointsOf(s)), 0)
  const pickedPoints = [...picked].reduce((n, id) => n + (subtreePoints[id] || 1), 0)
  const limit = sprint?.capacityPoints ?? velocity ?? null
  const limitLabel = sprint?.capacityPoints != null ? 'capacity' : 'avg velocity'
  const over = limit != null && plannedPoints + pickedPoints > limit

  function toggle(id) {
    setPicked(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  async function add() {
    if (!sprint || !picked.size) return
    setBusy(true); setError(''); setNotice('')
    try {
      await addStoriesToSprint(slug, sprint.id, [...picked])
      setNotice(`${picked.size} ${picked.size === 1 ? 'story' : 'stories'} added to ${sprint.name}. Backlog stories moved to To Do.`)
      setPicked(new Set())
    } catch (e) { setError(e.message) }
    setBusy(false)
  }

  async function remove(story) {
    setBusy(true); setError(''); setNotice('')
    try { await removeStoriesFromSprint(slug, sprint.id, [story.id]) } catch (e) { setError(e.message) }
    setBusy(false)
  }

  if (!open.length) {
    return (
      <div className="section-card epic-empty">
        No planned or active sprint to plan into.
        {canManage && <> <button className="btn-primary epic-btn-sm" onClick={onCreateSprint}>+ New Sprint</button></>}
      </div>
    )
  }

  return (
    <div className="planner">
      <div className="planner-col section-card">
        <div className="planner-head">
          <strong>Unplanned stories</strong>
          <span className="epic-muted">{available.length}</span>
        </div>
        <div className="planner-filters">
          <input className="form-input" placeholder="Search…" value={query} onChange={e => setQuery(e.target.value)} />
          <select className="form-input" value={epicFilter} onChange={e => setEpicFilter(e.target.value)}>
            <option value="">All epics</option>
            {epics.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            <option value="__none">No epic</option>
          </select>
          <label className="planner-toggle">
            <input type="checkbox" checked={onlyBacklog} onChange={e => setOnlyBacklog(e.target.checked)} /> Backlog only
          </label>
        </div>
        <div className="planner-list">
          {tasks === null && <div className="epic-muted">Loading stories…</div>}
          {tasks && available.length === 0 && <div className="epic-muted">Nothing left to plan.</div>}
          {available.map(t => {
            const epic = t.epicId ? epicsById[t.epicId] : null
            return (
              <label key={`${t.version || ''}:${t.id}`} className={`planner-row${picked.has(t.id) ? ' is-on' : ''}`}>
                {canManage && <input type="checkbox" checked={picked.has(t.id)} onChange={() => toggle(t.id)} />}
                <span className="task-number">{t.number}</span>
                <span className="planner-title">{t.title}</span>
                {Number(t.carryOver) > 0 && <span className={`carry-badge${t.carryOver > 1 ? ' carry-badge--hot' : ''}`} title={`Carried over ${t.carryOver}×`}>↻ {t.carryOver}</span>}
                {epic && <span className="epic-chip" style={{ '--status-color': epic.color }}>◆ {epic.name}</span>}
                <span className="epic-task-status">{(t.status || 'todo').replace(/-/g, ' ')}</span>
                <span className="planner-pts">{subtreePoints[t.id] || 1}p</span>
              </label>
            )
          })}
        </div>
        {canManage && (
          <div className="planner-foot">
            <span className="epic-muted">{picked.size} selected · {pickedPoints}p</span>
            <button className="btn-primary" onClick={add} disabled={busy || !picked.size || !sprint}>
              Add to {sprint ? sprint.name : 'sprint'} →
            </button>
          </div>
        )}
      </div>

      <div className="planner-col section-card">
        <div className="planner-head">
          <select className="form-input planner-sprint-select" value={sprintId} onChange={e => setSprintId(e.target.value)}>
            {open.map(s => <option key={s.id} value={s.id}>{s.name} — {SPRINT_STATUS[s.status].label}</option>)}
          </select>
          {sprint && <span className="epic-muted">{dateRange(sprint)}</span>}
        </div>
        {sprint && (
          <>
            {sprint.goal && <div className="sprint-goal">🎯 {sprint.goal}</div>}
            <div className={`planner-load${over ? ' is-over' : ''}`}>
              <div className="planner-load-nums">
                <strong>{plannedPoints}{pickedPoints ? ` + ${pickedPoints}` : ''}p</strong> planned
                {limit != null ? <> of <strong>{limit}p</strong> {limitLabel}</> : <span className="epic-muted"> · set a capacity or finish a sprint to get a limit</span>}
              </div>
              {limit != null && (
                <div className="epic-progress planner-load-bar">
                  <div className="epic-progress-fill" style={{ width: `${Math.min(100, ((plannedPoints + pickedPoints) / Math.max(limit, 1)) * 100)}%` }} />
                </div>
              )}
              {over && <div className="planner-warn">⚠ Over {limitLabel} by {Math.round((plannedPoints + pickedPoints - limit) * 10) / 10}p — this sprint is likely to carry work over.</div>}
            </div>
          </>
        )}
        {error && <div className="kanban-col-error">{error}</div>}
        {notice && <div className="planner-notice">{notice}</div>}
        <div className="planner-list">
          {sprint && planned.length === 0 && <div className="epic-muted">No stories yet — pick some on the left.</div>}
          {planned.map(s => {
            const epic = s.epicId ? epicsById[s.epicId] : null
            const carriedIn = (sprint.carriedInStoryIds || []).includes(s.id)
            return (
              <div key={s.id} className="planner-row">
                <span className="task-number">{s.number}</span>
                <span className="planner-title">{s.title}</span>
                {carriedIn && <span className="carry-badge" title="Carried in from the previous sprint">carried in</span>}
                {Number(s.carryOver) > 0 && <span className={`carry-badge${s.carryOver > 1 ? ' carry-badge--hot' : ''}`}>↻ {s.carryOver}</span>}
                {epic && <span className="epic-chip" style={{ '--status-color': epic.color }}>◆ {epic.name}</span>}
                <span className="epic-task-status">{(s.status || 'todo').replace(/-/g, ' ')}</span>
                <span className="planner-pts">{subtreePoints[s.id] || pointsOf(s)}p</span>
                {canManage && <button className="task-action-btn" onClick={() => remove(s)} disabled={busy} title="Remove from sprint">✕</button>}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
