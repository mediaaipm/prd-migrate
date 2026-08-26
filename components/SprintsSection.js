import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import Link from 'next/link'
import SubmitButton from './SubmitButton'
import { apiFetch } from '../lib/api-fetch'
import { enqueue, newId, onSync } from '../lib/submit-queue'
import { useOptimistic } from '../lib/optimistic'
import SprintBoard from './SprintBoard'

// ─── Active Sprint ────────────────────────────────────────────────────────────

function SprintProgressBar({ done, total }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const color = pct === 100 ? 'var(--tint-green-fg)' : pct >= 60 ? 'var(--tint-blue-fg)' : pct >= 30 ? 'var(--tint-amber-fg)' : 'var(--accent)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
      <div style={{ flex: 1, height: 8, background: 'var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 8, transition: 'width .4s ease', minWidth: pct > 0 ? 6 : 0 }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color, whiteSpace: 'nowrap' }}>{done}/{total}</span>
    </div>
  )
}

function SprintTaskChip({ task, sub }) {
  const isDone = task.status === 'done'
  const isInProgress = task.status === 'in-progress'
  const dotColor = isDone ? 'var(--tint-green-fg)' : isInProgress ? 'var(--tint-blue-fg)' : 'var(--muted)'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: sub ? '2px 8px' : '3px 10px',
      borderRadius: 20,
      fontSize: sub ? 11 : 12,
      fontWeight: 500,
      background: isDone ? 'var(--tint-green-bg)' : isInProgress ? 'var(--tint-blue-bg)' : 'var(--surface-2)',
      color: isDone ? 'var(--tint-green-fg)' : isInProgress ? 'var(--tint-blue-fg)' : 'var(--muted)',
      border: `1px solid ${isDone ? 'color-mix(in srgb, var(--tint-green-fg) 45%, transparent)' : isInProgress ? 'color-mix(in srgb, var(--tint-blue-fg) 45%, transparent)' : 'var(--border)'}`,
      textDecoration: isDone ? 'line-through' : 'none',
      whiteSpace: 'nowrap',
      opacity: sub ? 0.9 : 1,
    }}>
      <span style={{ width: sub ? 5 : 7, height: sub ? 5 : 7, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
      {task.number && <span style={{ fontSize: sub ? 9 : 10, color: 'var(--muted)' }}>#{task.number}</span>}
      {task.title}
    </span>
  )
}

function SprintChips({ tasks, sprintIdSet }) {
  const topItems = tasks.filter(t => !t.parentId || !sprintIdSet.has(t.parentId))
  function chain(task) {
    return [task, ...tasks.filter(t => t.parentId === task.id).flatMap(chain)]
  }
  const groups = topItems.map(chain)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {groups.map(group =>
        <div key={group[0].id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
          {group.flatMap((t, i) => [
            i > 0 ? <span key={`sep-${t.id}`} style={{ color: 'var(--border)', fontSize: 12, userSelect: 'none' }}>›</span> : null,
            <SprintTaskChip key={t.id} task={t} sub={i > 0} />,
          ]).filter(Boolean)}
        </div>
      )}
    </div>
  )
}


// Board or chips, for every sprint in the section at once. Chips are the compact
// read of what is in a sprint; the board is where the sprint is actually run.
function SprintViewToggle({ view, onChange }) {
  return (
    <div className="sprint-view-toggle" role="group" aria-label="Sprint view">
      <button
        type="button"
        className={view === 'board' ? 'is-on' : ''}
        onClick={() => onChange('board')}
        title="Kanban board — drag cards to move them"
      >▦ Board</button>
      <button
        type="button"
        className={view === 'chips' ? 'is-on' : ''}
        onClick={() => onChange('chips')}
        title="Compact chip list"
      >☰ Chips</button>
    </div>
  )
}

function formatSprintDate(d) {
  if (!d) return null
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function daysLeft(endDate) {
  if (!endDate) return null
  const diff = Math.ceil((new Date(endDate).setHours(23, 59, 59, 999) - Date.now()) / 86400000)
  return diff
}

// Holiday dates arrive as plain 'YYYY-MM-DD'. Handing that to `new Date()` and
// reading it back with local getters shifts the day west of Greenwich, so build
// and format it in UTC.
function formatHolidayDate(s) {
  const m = typeof s === 'string' && /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (!m) return ''
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
    .toLocaleDateString(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric' })
}

export default function SprintsSection({ slug, tasks: allTasks, currentUser, taskAcl, taskPrefix, onSprintChange, onViewAnalytics, refreshTrigger, newSprintTrigger }) {
  const [serverSprints, setServerSprints] = useState([])
  const [loadingS, setLoadingS]           = useState(true)
  const [showModal, setShowModal]         = useState(false)
  const [editingSprint, setEditingSprint] = useState(null)
  const [showCompleted, setShowCompleted] = useState(false)

  const [formName, setFormName]       = useState('')
  const [formStart, setFormStart]     = useState('')
  const [formEnd, setFormEnd]         = useState('')
  const [formTaskIds, setFormTaskIds] = useState([])
  const [formStatus, setFormStatus]   = useState('active')
  const [formGoal, setFormGoal]         = useState('')
  const [formCapacity, setFormCapacity] = useState('')
  const [taskSearch, setTaskSearch]     = useState('')

  // Working-day and holiday figures for the banner. Purely additive: a failed or
  // missing analytics endpoint leaves this null and every element it feeds is
  // skipped, so the banner falls back to exactly what it rendered before.
  const [analytics, setAnalytics] = useState(null)

  const sprints = useOptimistic(serverSprints, { entity: 'sprint', scope: `/api/projects/${slug}/sprint` })

  const loadSprints = useCallback(() => {
    if (!slug) return Promise.resolve()
    return apiFetch(`/api/projects/${slug}/sprint`)
      .then(r => r.ok ? r.json() : [])
      .then(data => { setServerSprints(Array.isArray(data) ? data : []); setLoadingS(false) })
      .catch(() => setLoadingS(false))
  }, [slug])

  const loadAnalytics = useCallback(() => {
    if (!slug) return Promise.resolve()
    return apiFetch(`/api/projects/${slug}/sprint-analytics`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setAnalytics(d && typeof d === 'object' ? d : null))
      .catch(() => setAnalytics(null))
  }, [slug])

  useEffect(() => { loadSprints(); loadAnalytics() }, [loadSprints, loadAnalytics])
  useEffect(() => onSync(item => {
    if (item.optimistic?.entity === 'sprint') { loadAnalytics(); return loadSprints() }
  }), [loadSprints, loadAnalytics])
  useEffect(() => { if (refreshTrigger > 0) { loadSprints(); loadAnalytics() } }, [refreshTrigger]) // eslint-disable-line react-hooks/exhaustive-deps

  // SprintSummary per sprint id — the only thing the banner reads from analytics.
  const metrics = useMemo(() => {
    const out = {}
    for (const s of (Array.isArray(analytics?.sprints) ? analytics.sprints : [])) {
      if (s && s.id) out[s.id] = s
    }
    return out
  }, [analytics])
  // Board or chips, remembered per project. Board is the default: a sprint is a thing
  // you run, and chips only read back what was planned. Read in an effect rather than
  // in the initializer so the server and the first client render agree.
  const [view, setView] = useState('board')
  useEffect(() => {
    if (!slug) return
    try {
      const saved = localStorage.getItem(`sprint-view:${slug}`)
      if (saved === 'board' || saved === 'chips') setView(saved)
    } catch {}
  }, [slug])
  function chooseView(next) {
    setView(next)
    try { localStorage.setItem(`sprint-view:${slug}`, next) } catch {}
  }

  // A sprint record embeds a snapshot of its tasks as of the last GET; the page's task
  // list is the optimistic one. Prefer the live copy for root-list tasks so a card
  // dropped into a new column stays there instead of springing back until the sprint
  // refetch lands. Version-scoped cards keep the embedded copy — a task id is only
  // unique within its own version list.
  const liveById = useMemo(() => new Map((allTasks || []).map(t => [t.id, t])), [allTasks])
  const resolveItems = useCallback(items => (items || []).map(t => {
    const live = t.version ? null : liveById.get(t.id)
    return live ? { ...t, ...live } : t
  }), [liveById])

  const lastNewSprintTrigger = useRef(newSprintTrigger)
  useEffect(() => {
    if (newSprintTrigger === lastNewSprintTrigger.current) return // ignore mount / remount
    lastNewSprintTrigger.current = newSprintTrigger
    openNew()
  }, [newSprintTrigger]) // eslint-disable-line react-hooks/exhaustive-deps

  function openNew() {
    setEditingSprint(null)
    setFormName(''); setFormStart(''); setFormEnd(''); setFormTaskIds([]); setFormStatus('active')
    setFormGoal(''); setFormCapacity(''); setTaskSearch('')
    setShowModal(true)
  }

  function openEdit(sprint) {
    setEditingSprint(sprint)
    setFormName(sprint.name || '')
    setFormStart(sprint.startDate || '')
    setFormEnd(sprint.endDate || '')
    setFormTaskIds(sprint.taskIds || [])
    setFormStatus(sprint.status || 'active')
    setFormGoal(sprint.goal || '')
    setFormCapacity(sprint.capacityPoints == null ? '' : String(sprint.capacityPoints))
    setTaskSearch('')
    setShowModal(true)
  }

  const sprintScope = `/api/projects/${slug}/sprint`

  // Blank means "no capacity planned", which is a null on the record — not 0,
  // which would read as a sprint that can hold nothing.
  function capacityValue(raw) {
    const trimmed = String(raw ?? '').trim()
    if (!trimmed) return null
    const n = Number(trimmed)
    return Number.isFinite(n) && n >= 0 ? n : null
  }

  function handleSave(e) {
    e.preventDefault()
    const body = {
      name: formName,
      startDate: formStart || null,
      endDate: formEnd || null,
      taskIds: formTaskIds,
      status: formStatus,
      goal: formGoal,
      capacityPoints: capacityValue(formCapacity),
    }
    if (editingSprint) {
      enqueue({
        url: `${sprintScope}?id=${editingSprint.id}`,
        method: 'PUT',
        body,
        label: `Update sprint “${formName}”`,
        optimistic: { entity: 'sprint', op: 'update', scope: sprintScope, id: editingSprint.id, patch: body },
      })
    } else {
      const id = newId('sprint')
      enqueue({
        url: sprintScope,
        method: 'POST',
        body: { ...body, id },
        label: `Create sprint “${formName}”`,
        // `tasks` is what the hydrated GET returns; seed it so the card renders.
        optimistic: { entity: 'sprint', op: 'create', scope: sprintScope, data: { ...body, id, tasks: [], createdAt: new Date().toISOString() } },
      })
    }
    setShowModal(false)
    onSprintChange?.()
  }

  // The sprint PUT replaces the whole record, so every status flip has to resend the
  // fields it is not changing.
  function setSprintStatus(sprint, status) {
    const body = {
      name: sprint.name, startDate: sprint.startDate, endDate: sprint.endDate,
      taskIds: sprint.taskIds, status,
      // The PUT replaces the record, so the goal and capacity have to ride along
      // or starting a sprint would silently erase them.
      goal: sprint.goal ?? '',
      capacityPoints: sprint.capacityPoints ?? null,
    }
    enqueue({
      url: `${sprintScope}?id=${sprint.id}`,
      method: 'PUT',
      body,
      label: `${status === 'completed' ? 'Complete' : 'Start'} sprint “${sprint.name}”`,
      optimistic: { entity: 'sprint', op: 'update', scope: sprintScope, id: sprint.id, patch: { status } },
    })
    onSprintChange?.()
  }

  function completeSprint(sprint) {
    if (!confirm(`Mark "${sprint.name}" as completed?`)) return
    setSprintStatus(sprint, 'completed')
  }

  function startSprint(sprint) {
    setSprintStatus(sprint, 'active')
  }

  function handleDelete(sprint) {
    if (!confirm(`Delete "${sprint.name}"? This cannot be undone.`)) return
    enqueue({
      url: `${sprintScope}?id=${sprint.id}`,
      method: 'DELETE',
      label: `Delete sprint “${sprint.name}”`,
      optimistic: { entity: 'sprint', op: 'delete', scope: sprintScope, id: sprint.id },
    })
    onSprintChange?.()
  }

  function toggleTask(id) {
    setFormTaskIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const rootTasks = (allTasks || []).filter(t => !t.parentId)
  const subtasksByParent = (allTasks || []).reduce((acc, t) => {
    if (t.parentId) { acc[t.parentId] = acc[t.parentId] || []; acc[t.parentId].push(t) }
    return acc
  }, {})

  // Which rows the picker search leaves standing. null means "no search" — the
  // whole tree renders. A row survives when it matches, when a descendant matches
  // (the path to a hit has to stay reachable) or when an ancestor matched (a hit's
  // own sub-tasks stay tickable without retyping).
  const taskQuery = taskSearch.trim().toLowerCase()
  const visibleTaskIds = useMemo(() => {
    if (!taskQuery) return null
    const num = taskQuery.replace(/^#/, '')
    const list = allTasks || []
    const byId = new Map(list.map(t => [t.id, t]))
    const kids = list.reduce((acc, t) => {
      if (t.parentId) { acc[t.parentId] = acc[t.parentId] || []; acc[t.parentId].push(t) }
      return acc
    }, {})
    const hit = t => String(t.title || '').toLowerCase().includes(taskQuery)
      || (num !== '' && String(t.number ?? '').startsWith(num))
    const keep = new Set()
    const expanded = new Set() // guards recursion; `keep` alone would stop a
    const addSubtree = id => {  // branch short of rows added as an ancestor path
      if (expanded.has(id)) return
      expanded.add(id)
      for (const c of (kids[id] || [])) { keep.add(c.id); addSubtree(c.id) }
    }
    for (const t of list) {
      if (!hit(t)) continue
      keep.add(t.id)
      addSubtree(t.id)
      let p = t.parentId ? byId.get(t.parentId) : null
      const seen = new Set([t.id])
      while (p && !seen.has(p.id)) { seen.add(p.id); keep.add(p.id); p = p.parentId ? byId.get(p.parentId) : null }
    }
    return keep
  }, [allTasks, taskQuery])

  const shownRootTasks = visibleTaskIds ? rootTasks.filter(t => visibleTaskIds.has(t.id)) : rootTasks

  function countDescendants(taskId) {
    const kids = subtasksByParent[taskId] || []
    return kids.reduce((n, k) => n + 1 + countDescendants(k.id), 0)
  }
  function countSelectedDescendants(taskId) {
    const kids = subtasksByParent[taskId] || []
    return kids.reduce((n, k) => n + (formTaskIds.includes(k.id) ? 1 : 0) + countSelectedDescendants(k.id), 0)
  }

  function renderTaskRow(t, depth) {
    if (visibleTaskIds && !visibleTaskIds.has(t.id)) return null
    const d = depth || 0
    const children = subtasksByParent[t.id] || []
    const totalDesc = countDescendants(t.id)
    const selDesc = countSelectedDescendants(t.id)
    const bgColors = [
      'var(--surface)',
      'color-mix(in srgb, var(--surface) 97%, var(--text))',
      'color-mix(in srgb, var(--surface) 94%, var(--text))',
      'color-mix(in srgb, var(--surface) 91%, var(--text))',
    ]
    const bgSelected = [
      'color-mix(in srgb, var(--surface) 90%, var(--accent))',
      'color-mix(in srgb, var(--surface) 87%, var(--accent))',
      'color-mix(in srgb, var(--surface) 84%, var(--accent))',
      'color-mix(in srgb, var(--surface) 81%, var(--accent))',
    ]
    const indentPx = 14 + d * 18
    return (
      <div key={t.id}>
        <label style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: `7px 14px 7px ${indentPx}px`,
          borderBottom: '1px solid var(--border)',
          cursor: 'pointer', fontSize: d === 0 ? 13 : 12,
          background: formTaskIds.includes(t.id) ? (bgSelected[Math.min(d, bgSelected.length - 1)]) : (bgColors[Math.min(d, bgColors.length - 1)]),
          transition: 'background .1s',
        }}>
          {d > 0 && <span style={{ fontSize: 9, color: 'var(--muted)', flexShrink: 0 }}>↳</span>}
          <input type="checkbox" checked={formTaskIds.includes(t.id)} onChange={() => toggleTask(t.id)} style={{ flexShrink: 0 }} />
          {t.number && <span style={{ fontSize: d === 0 ? 11 : 10, color: 'var(--muted)', flexShrink: 0 }}>#{t.number}</span>}
          <span style={{ flex: 1, fontWeight: d === 0 ? 600 : 400, color: 'var(--text)', textDecoration: t.status === 'done' ? 'line-through' : 'none' }}>{t.title}</span>
          {totalDesc > 0 && <span style={{ fontSize: 10, color: 'var(--muted)', flexShrink: 0 }}>{selDesc}/{totalDesc}</span>}
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 10, flexShrink: 0,
            background: t.status === 'done' ? 'var(--tint-green-bg)' : t.status === 'in-progress' ? 'var(--tint-blue-bg)' : 'var(--tint-slate-bg)',
            color: t.status === 'done' ? 'var(--tint-green-fg)' : t.status === 'in-progress' ? 'var(--tint-blue-fg)' : 'var(--muted)',
          }}>{t.status}</span>
        </label>
        {children.map(c => renderTaskRow(c, d + 1))}
      </div>
    )
  }

  const activeSprints   = sprints.filter(s => s.status === 'active')
  const plannedSprints  = sprints.filter(s => s.status === 'planned')
  const completedSprints = sprints.filter(s => s.status === 'completed')

  if (loadingS) return null

  return (
    <>
      {/* Active sprint banners */}
      {activeSprints.map(sprint => {
        const sprintIdSet  = new Set(sprint.taskIds || [])
        const allItems     = resolveItems(sprint.tasks)
        const doneTasks    = allItems.filter(t => t.status === 'done').length
        const remaining = daysLeft(sprint.endDate)
        const isOverdue = remaining !== null && remaining < 0
        // Null whenever analytics is unavailable — every element below that reads
        // it is skipped, leaving the banner exactly as it was.
        const m = metrics[sprint.id] || null
        const sprintHolidays = Array.isArray(m?.holidays) ? m.holidays.slice(0, 3) : []
        return (
          <div key={sprint.id} style={{
            border: '1px solid color-mix(in srgb, var(--tint-indigo-fg) 45%, transparent)', borderRadius: 12,
            background: 'linear-gradient(135deg, var(--tint-indigo-bg) 0%, var(--tint-green-bg) 100%)',
            padding: '16px 20px', marginBottom: 10,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: allItems.length > 0 ? 12 : 0 }}>
              <span style={{ fontSize: 16 }}>⚡</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--tint-indigo-fg)' }}>Active Sprint:</span>
              <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--tint-indigo-fg)' }}>{sprint.name}</span>
              {(sprint.startDate || sprint.endDate) && (
                <span style={{ fontSize: 12, color: 'var(--tint-gray-fg)' }}>
                  {formatSprintDate(sprint.startDate)}{sprint.startDate && sprint.endDate ? ' – ' : ''}{formatSprintDate(sprint.endDate)}
                </span>
              )}
              {remaining !== null && (
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                  background: isOverdue ? 'var(--tint-red-bg)' : remaining <= 2 ? 'var(--tint-amber-bg)' : 'var(--tint-green-bg)',
                  color: isOverdue ? 'var(--tint-red-fg)' : remaining <= 2 ? 'var(--tint-amber-fg)' : 'var(--tint-green-fg)',
                  border: `1px solid ${isOverdue ? 'var(--tint-red-border)' : remaining <= 2 ? 'color-mix(in srgb, var(--tint-amber-fg) 45%, transparent)' : 'color-mix(in srgb, var(--tint-green-fg) 45%, transparent)'}`,
                }}>
                  {isOverdue ? `${Math.abs(remaining)}d overdue` : remaining === 0 ? 'Ends today' : `${remaining}d left`}
                </span>
              )}
              {m && sprint.endDate && (
                <span className="sprint-workdays">
                  {Number(m.workingDaysLeft) || 0} working day{(Number(m.workingDaysLeft) || 0) === 1 ? '' : 's'} left
                </span>
              )}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                <SprintViewToggle view={view} onChange={chooseView} />
                {onViewAnalytics ? (
                  <button type="button" onClick={() => onViewAnalytics(sprint.id)} className="sprint-analytics-link">
                    Analytics
                  </button>
                ) : (
                  <Link href={`/projects/${slug}/sprints?sprint=${encodeURIComponent(sprint.id)}`} className="sprint-analytics-link">
                    Analytics
                  </Link>
                )}
                <button onClick={() => openEdit(sprint)} style={{
                  padding: '5px 12px', borderRadius: 7, border: '1px solid color-mix(in srgb, var(--tint-indigo-fg) 45%, transparent)',
                  background: 'var(--surface)', color: 'var(--tint-indigo-fg)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}>Manage</button>
                <button onClick={() => completeSprint(sprint)} style={{
                  padding: '5px 12px', borderRadius: 7, border: '1px solid color-mix(in srgb, var(--tint-green-fg) 45%, transparent)',
                  background: 'var(--surface)', color: 'var(--tint-green-fg)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}>Complete</button>
                <button onClick={() => handleDelete(sprint)} style={{
                  padding: '5px 12px', borderRadius: 7, border: '1px solid var(--tint-red-border)',
                  background: 'var(--surface)', color: 'var(--tint-red-fg)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}>Delete</button>
              </div>
            </div>
            {sprint.goal && <p className="sprint-goal">{sprint.goal}</p>}
            {sprintHolidays.length > 0 && (
              <div className="sprint-holiday-strip">
                {sprintHolidays.map((h, i) => (
                  <span key={h?.date || `hol-${i}`} className="sprint-holiday-chip" title={`${h?.name || 'Holiday'} · ${h?.type || 'public'}`}>
                    {formatHolidayDate(h?.date)} · {h?.name || 'Holiday'}
                  </span>
                ))}
              </div>
            )}
            {allItems.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <SprintProgressBar done={doneTasks} total={allItems.length} />
              </div>
            )}
            {allItems.length > 0 && (view === 'board' ? (
              <SprintBoard
                slug={slug}
                tasks={allItems}
                allTasks={allTasks}
                currentUser={currentUser}
                taskAcl={taskAcl}
                taskPrefix={taskPrefix}
              />
            ) : (
              <SprintChips tasks={allItems} sprintIdSet={sprintIdSet} />
            ))}
            {allItems.length === 0 && (
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
                No tasks in this sprint yet — click <strong>Manage</strong> to add some.
              </p>
            )}
          </div>
        )
      })}

      {/* Planned sprints */}
      {plannedSprints.length > 0 && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface-2)', padding: '12px 16px', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.05em' }}>PLANNED</span>
            <div style={{ marginLeft: 'auto' }}><SprintViewToggle view={view} onChange={chooseView} /></div>
          </div>
          {plannedSprints.map((sprint, i) => {
            const sprintIdSet = new Set(sprint.taskIds || [])
            const allItems    = resolveItems(sprint.tasks)
            return (
              <div key={sprint.id} style={{
                padding: '8px 0', borderBottom: i < plannedSprints.length - 1 ? '1px solid var(--border)' : 'none',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14 }}>📋</span>
                  <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>{sprint.name}</span>
                  {(sprint.startDate || sprint.endDate) && (
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {formatSprintDate(sprint.startDate)}{sprint.startDate && sprint.endDate ? ' – ' : ''}{formatSprintDate(sprint.endDate)}
                    </span>
                  )}
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{allItems.length} tasks</span>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    <button onClick={() => startSprint(sprint)} style={{
                      padding: '4px 10px', borderRadius: 6, border: '1px solid var(--tint-indigo-fg)',
                      background: 'var(--tint-indigo-fg)', color: 'var(--surface)', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    }}>▶ Start</button>
                    <button onClick={() => openEdit(sprint)} style={{
                      padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)',
                      background: 'var(--surface)', color: 'var(--muted)', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    }}>Edit</button>
                    <button onClick={() => handleDelete(sprint)} style={{
                      padding: '4px 10px', borderRadius: 6, border: '1px solid var(--tint-red-border)',
                      background: 'var(--surface)', color: 'var(--tint-red-fg)', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    }}>Delete</button>
                  </div>
                </div>
                {allItems.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    {view === 'board' ? (
                      <SprintBoard
                        slug={slug}
                        tasks={allItems}
                        allTasks={allTasks}
                        currentUser={currentUser}
                        taskAcl={taskAcl}
                        taskPrefix={taskPrefix}
                      />
                    ) : (
                      <SprintChips tasks={allItems} sprintIdSet={sprintIdSet} />
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Completed sprints */}
      {completedSprints.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <button onClick={() => setShowCompleted(v => !v)} style={{
            background: 'none', border: 'none', cursor: 'pointer', fontSize: 12,
            color: 'var(--muted)', fontWeight: 600, padding: '4px 0', display: 'flex', alignItems: 'center', gap: 6,
          }}>
            {showCompleted ? '▾' : '▸'} Completed sprints ({completedSprints.length})
          </button>
          {showCompleted && (
            <div style={{ border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface-2)', padding: '10px 14px', marginTop: 6 }}>
              {completedSprints.map((sprint, i) => {
                const sprintIdSet = new Set(sprint.taskIds || [])
                const allItems    = resolveItems(sprint.tasks)
                const doneTasks   = allItems.filter(t => t.status === 'done').length
                return (
                  <div key={sprint.id} style={{
                    padding: '7px 0', borderBottom: i < completedSprints.length - 1 ? '1px solid var(--border)' : 'none',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13 }}>✓</span>
                      <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>{sprint.name}</span>
                      {(sprint.startDate || sprint.endDate) && (
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                          {formatSprintDate(sprint.startDate)}{sprint.startDate && sprint.endDate ? ' – ' : ''}{formatSprintDate(sprint.endDate)}
                        </span>
                      )}
                      <span style={{ fontSize: 12, color: 'var(--tint-green-fg)', fontWeight: 600 }}>{doneTasks}/{allItems.length} done</span>
                      <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                        <button onClick={() => handleDelete(sprint)} style={{
                          padding: '3px 8px', borderRadius: 6, border: '1px solid var(--tint-red-border)',
                          background: 'var(--surface)', color: 'var(--tint-red-fg)', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                        }}>Delete</button>
                      </div>
                    </div>
                    {allItems.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <SprintChips tasks={allItems} sprintIdSet={sprintIdSet} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Create / Edit modal */}
      {showModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
        }} onClick={e => { if (e.target === e.currentTarget) setShowModal(false) }}>
          <div style={{
            background: 'var(--surface)', borderRadius: 14, width: '100%', maxWidth: 520,
            boxShadow: '0 20px 60px rgba(0,0,0,.18)', maxHeight: '90vh', display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>{editingSprint ? 'Edit Sprint' : 'New Sprint'}</h2>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--muted)', lineHeight: 1 }}>×</button>
            </div>
            <form onSubmit={handleSave} style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto' }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 5 }}>Sprint Name *</label>
                <input value={formName} onChange={e => setFormName(e.target.value)} placeholder="e.g. Sprint 3" required
                  style={{ width: '100%', padding: '8px 11px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 5 }}>Status</label>
                <select value={formStatus} onChange={e => setFormStatus(e.target.value)}
                  style={{ width: '100%', padding: '8px 11px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, boxSizing: 'border-box' }}>
                  <option value="active">Active</option>
                  <option value="planned">Planned</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 5 }}>Start Date</label>
                  <input type="date" value={formStart} onChange={e => setFormStart(e.target.value)}
                    style={{ width: '100%', padding: '8px 11px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 5 }}>End Date</label>
                  <input type="date" value={formEnd} onChange={e => setFormEnd(e.target.value)}
                    style={{ width: '100%', padding: '8px 11px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, boxSizing: 'border-box' }} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 5 }}>Sprint Goal</label>
                <textarea value={formGoal} onChange={e => setFormGoal(e.target.value)} rows={2}
                  placeholder="What does this sprint set out to achieve?"
                  style={{ width: '100%', padding: '8px 11px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 5 }}>Capacity (points)</label>
                <input type="number" min={0} step={1} value={formCapacity} onChange={e => setFormCapacity(e.target.value)}
                  placeholder="Leave blank if you don't plan in points"
                  style={{ width: '100%', padding: '8px 11px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 8 }}>
                  Tasks in Sprint <span style={{ fontWeight: 400 }}>({formTaskIds.length} selected)</span>
                </label>
                <div style={{ position: 'relative', marginBottom: 8 }}>
                  <input
                    type="text"
                    value={taskSearch}
                    onChange={e => setTaskSearch(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Escape' && taskSearch) { e.preventDefault(); e.stopPropagation(); setTaskSearch('') } }}
                    placeholder="Search tasks by title or #number"
                    style={{ width: '100%', padding: '7px 30px 7px 11px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, boxSizing: 'border-box' }} />
                  {taskSearch && (
                    <button type="button" onClick={() => setTaskSearch('')} aria-label="Clear search"
                      style={{
                        position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                        background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)',
                        fontSize: 16, lineHeight: 1, padding: '2px 5px',
                      }}>×</button>
                  )}
                </div>
                <div style={{ border: '1px solid var(--border)', borderRadius: 8, maxHeight: 300, overflowY: 'auto' }}>
                  {rootTasks.length === 0 && (
                    <p style={{ padding: '12px 14px', color: 'var(--muted)', fontSize: 13, margin: 0 }}>No tasks available.</p>
                  )}
                  {rootTasks.length > 0 && shownRootTasks.length === 0 && (
                    <p style={{ padding: '12px 14px', color: 'var(--muted)', fontSize: 13, margin: 0 }}>No tasks match &ldquo;{taskSearch.trim()}&rdquo;.</p>
                  )}
                  {shownRootTasks.map(t => renderTaskRow(t, 0))}
                </div>
                {visibleTaskIds && shownRootTasks.length > 0 && (
                  <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--muted)' }}>
                    Filtered — selections you made outside the search are kept.
                  </p>
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 4 }}>
                <button type="button" onClick={() => setShowModal(false)} className="btn-ghost" style={{ fontSize: 13, padding: '7px 16px' }}>Cancel</button>
                <SubmitButton type="submit" onClick={handleSave} className="" style={{
                  padding: '7px 20px', borderRadius: 8, border: 'none',
                  background: 'var(--tint-indigo-fg)', color: 'var(--surface)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}>{editingSprint ? 'Save Changes' : 'Create Sprint'}</SubmitButton>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
