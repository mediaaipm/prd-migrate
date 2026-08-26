import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import TaskForm from './TaskForm'
import { apiFetch } from '../lib/api-fetch'
import { enqueue } from '../lib/submit-queue'
import { useColumns, columnsWithTaskStatuses } from '../lib/kanban-columns'
import { useCategories, categoriesWithTaskValues } from '../lib/categories'
import { unmetAcceptance, acceptanceProgress } from '../lib/task-acceptance'

const PRIORITY_COLOR = { low: '#64748b', medium: '#f59e0b', high: '#dc2626', critical: '#9f1239' }
const PRIORITY_LABEL = { low: 'Low', medium: 'Med', high: 'High', critical: 'Crit' }

function isOverdue(dueDate) {
  if (!dueDate) return false
  return new Date(dueDate) < new Date()
}

function formatDate(d) {
  if (!d) return null
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function assigneeNames(task) {
  const list = Array.isArray(task?.assignees) ? task.assignees : (task?.assignee ? [task.assignee] : [])
  return list.map(a => (typeof a === 'object' ? a?.name : a)).filter(Boolean)
}

// The sprint's own kanban: the same statuses the project board uses, but scoped to
// one sprint's membership and nothing else. It is where a sprint is *run* — drag a
// card and the sprint's progress bar, its burndown and its velocity all move with it
// — while the Kanban tab stays the place where the backlog is shaped.
//
// Deliberately not KanbanBoard: that board owns column editing, filters, creation and
// the full card modal, none of which belong inside a sprint banner. Moving a card is
// the one mutation here; everything else is a click through to the task page.
export default function SprintBoard({ slug, tasks, allTasks, currentUser, taskAcl, taskPrefix }) {
  const serverColumns = useColumns(slug)
  // A card parked in a status with no column (deleted, or set from another project's
  // layout) would otherwise be invisible — and invisible work in a sprint reads as
  // work that does not exist.
  const columns = useMemo(() => columnsWithTaskStatuses(serverColumns, tasks), [serverColumns, tasks])

  const [draggingId, setDraggingId] = useState(null)
  const [overStatus, setOverStatus] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const wrapRef = useRef(null)
  const panState = useRef({ isPanning: false, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0 })

  // Picker options for the edit form. Fetched on the first card opened rather than on
  // mount: a page can hold several sprint boards, and most visits never open a card.
  const [assignees, setAssignees] = useState([])
  const [labels, setLabels] = useState([])
  const optionsLoaded = useRef(false)
  const savedCategories = useCategories(slug)
  const categories = useMemo(() => categoriesWithTaskValues(savedCategories, tasks), [savedCategories, tasks])

  // Same rules the project board applies, and the same ones the task PUT enforces:
  // admins edit anything, an assignee may move only their own card, and only into a
  // status the project ACL and the superadmin blocklist both allow.
  const canEditAll = !!currentUser?.isAdmin
  const isMine = task => !!currentUser?.name && assigneeNames(task).includes(currentUser.name)
  const canMove = task => canEditAll || isMine(task)
  const restrictedStatuses = new Set(currentUser?.restrictedStatuses || [])
  const statusAllowedForUser = status => {
    if (!currentUser?.isAdmin && restrictedStatuses.has(status)) return false
    if (canEditAll) return true
    if (taskAcl?.assigneeCanChangeStatus === false) return false
    const list = taskAcl?.assigneeStatuses
    if (!Array.isArray(list)) return true
    return list.includes(status)
  }

  // Sprint membership.
  const byId = useMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks])
  // Everything the page can resolve: the project's task list plus the sprint's own
  // copies (which win — they carry the version the card was hydrated from). A story
  // pulled into a sprint without its parent still knows what it belongs to.
  const projectById = useMemo(() => {
    const m = new Map((allTasks || []).map(t => [t.id, t]))
    for (const t of tasks) m.set(t.id, t)
    return m
  }, [allTasks, tasks])

  // Direct children *in the sprint*, whatever column they sit in — that is what the
  // "n/m sub" chip counts.
  const kidsOf = useMemo(() => {
    const m = new Map()
    for (const t of tasks) {
      if (!t.parentId || !byId.has(t.parentId)) continue
      m.set(t.parentId, [...(m.get(t.parentId) || []), t])
    }
    return m
  }, [tasks, byId])

  const hasPoints = tasks.some(t => Number.isFinite(Number(t.points)) && Number(t.points) > 0)
  const pointsOf = list => list.reduce((n, t) => n + (Number(t.points) || 0), 0)
  const sortBoard = arr => arr.slice().sort((a, b) => (a.boardOrder ?? a.order ?? 0) - (b.boardOrder ?? b.order ?? 0))

  // Nearest ancestor that is itself drawn in this column — the card this one nests
  // under. The walk climbs through ancestors that are *not* in the sprint (a
  // grandchild can still belong under a grandparent that is), but only a sprint
  // member sharing the column can host it. Null => it draws top-level, with a
  // breadcrumb saying what it hangs off.
  function nearestAncestorInCol(task, status) {
    const seen = new Set([task.id])
    let cur = task.parentId ? projectById.get(task.parentId) : null
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id)
      if (byId.has(cur.id) && (cur.status || 'todo') === status) return cur.id
      cur = cur.parentId ? projectById.get(cur.parentId) : null
    }
    return null
  }

  // One rule covers both halves of a column: a card is top-level here when nothing
  // above it is drawn here, and a child when something is.
  const colTasks = status => sortBoard(
    tasks.filter(t => (t.status || 'todo') === status && nearestAncestorInCol(t, status) === null)
  )
  const childrenInCol = (taskId, status) => sortBoard(
    tasks.filter(t => (t.status || 'todo') === status && nearestAncestorInCol(t, status) === taskId)
  )
  // Every sprint card in the column, nested or not — what the column counter and the
  // point total have to add up.
  const allInCol = status => tasks.filter(t => (t.status || 'todo') === status)

  // Tasks live one list per version; the sprint spans them all, so each card carries
  // the version it was hydrated from and writes go to that version's route.
  function apiBaseFor(task) {
    return task.version
      ? `/api/projects/${slug}/versions/${task.version}/tasks`
      : `/api/projects/${slug}/tasks`
  }

  // Closing a story with criteria outstanding is allowed, but never by accident.
  // Mirrors the prompt the project board gives on every path into `done`.
  function confirmAcceptance(task) {
    const unmet = unmetAcceptance(task)
    if (!unmet.length) return true
    const listed = unmet.slice(0, 5).map(i => '• ' + i.text).join('\n')
    const more = unmet.length > 5 ? '\n• …and ' + (unmet.length - 5) + ' more' : ''
    return window.confirm(
      '“' + task.title + '” has ' + unmet.length + ' unmet acceptance '
      + (unmet.length === 1 ? 'criterion' : 'criteria') + ':\n\n' + listed + more
      + '\n\nMove it to Done anyway?'
    )
  }

  function moveTask(task, status) {
    if (!task || (task.status || 'todo') === status) return
    if (!canMove(task)) return
    if (!statusAllowedForUser(status)) {
      alert('You are not allowed to move tasks to this status.')
      return
    }
    if (status === 'done' && !confirmAcceptance(task)) return
    const base = apiBaseFor(task)
    enqueue({
      url: `${base}/${task.id}`,
      method: 'PUT',
      body: { status },
      label: `Move “${task.title}” to ${status}`,
      // Same scope string the Tasks page uses, so a card moved here is already moved
      // when the user walks over to the board.
      optimistic: { entity: 'task', op: 'update', scope: base, id: task.id, patch: { status } },
    })
  }

  // Clicking a card edits it here. The sprint page is where the sprint is run, so
  // being thrown to the task list to change a title is a round trip out of the very
  // view you were working in.
  const editing = editingId ? projectById.get(editingId) || null : null
  const canEditCard = canEditAll

  function openCard(task) {
    setEditingId(task.id)
    if (optionsLoaded.current) return
    optionsLoaded.current = true
    apiFetch('/api/assignees').then(r => (r.ok ? r.json() : [])).then(d => setAssignees(Array.isArray(d) ? d : [])).catch(() => {})
    apiFetch(`/api/projects/${slug}/labels`).then(r => (r.ok ? r.json() : [])).then(d => setLabels(Array.isArray(d) ? d : [])).catch(() => {})
  }

  // The full card — comments, attachments, history, authoring acceptance criteria —
  // still lives on the task page. This is the link there, not a redirect on click.
  function fullCardHref(task) {
    const q = task.version
      ? `?version=${encodeURIComponent(task.version)}&task=${encodeURIComponent(task.id)}`
      : `?task=${encodeURIComponent(task.id)}`
    return `/projects/${slug}/tasks${q}`
  }

  function toEditForm(task) {
    return {
      title: task.title || '',
      description: task.description || '',
      status: task.status || 'todo',
      priority: task.priority || 'medium',
      category: task.category || '',
      assignees: Array.isArray(task.assignees) ? task.assignees : (task.assignee ? [task.assignee] : []),
      startDate: task.startDate ? task.startDate.slice(0, 10) : '',
      dueDate: task.dueDate ? task.dueDate.slice(0, 10) : '',
      // Seeded from the task so saving cannot silently drop an override the form
      // never showed as changed.
      numberOverride: task.numberOverride || '',
      // Empty string, not null: this is an <input> value, and the PUT normalises it back.
      points: task.points == null ? '' : String(task.points),
      attachments: Array.isArray(task.attachments) ? task.attachments : [],
      cover: task.cover || null,
      labelIds: Array.isArray(task.labelIds) ? task.labelIds : [],
    }
  }

  function saveEdit(form) {
    if (!editing || !form.title.trim()) return
    const body = {
      ...form,
      // Blank means "inherit from the nearest ancestor", which is null in redis — an
      // empty string works by accident (falsy) but reads as a real value there.
      category: form.category || null,
      points: form.points === '' || form.points == null ? null : Number(form.points),
      numberOverride: form.numberOverride || null,
    }
    // Same definition-of-done prompt a drag into Done gives.
    if (body.status === 'done' && editing.status !== 'done'
      && !confirmAcceptance({ title: form.title, acceptance: editing.acceptance })) return
    const base = apiBaseFor(editing)
    enqueue({
      url: `${base}/${editing.id}`,
      method: 'PUT',
      body,
      label: `Save card “${form.title.trim()}”`,
      optimistic: { entity: 'task', op: 'update', scope: base, id: editing.id, patch: body },
    })
    setEditingId(null)
  }

  // Esc closes the modal. TaskForm handles its own Esc, but the read-only view has
  // no form to catch it.
  useEffect(() => {
    if (!editingId) return
    const onKey = e => { if (e.key === 'Escape') setEditingId(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editingId])

  // Grab-to-pan the whole board, so a sprint with more lanes than fit is reachable
  // without hunting for the scrollbar. Cards and controls are excluded: the
  // preventDefault below would otherwise swallow a card's own dragstart.
  function onPanStart(e) {
    if (e.button !== 0) return
    if (e.target.closest('.sprint-card') || e.target.closest('button') ||
        e.target.closest('select') || e.target.closest('input') || e.target.closest('a')) return
    const wrap = wrapRef.current
    if (!wrap) return
    panState.current = {
      isPanning: true,
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: wrap.scrollLeft,
      scrollTop: wrap.scrollTop,
    }
    wrap.style.cursor = 'grabbing'
    e.preventDefault()
  }

  function onPanMove(e) {
    const ps = panState.current
    if (!ps.isPanning) return
    const wrap = wrapRef.current
    if (!wrap) return
    wrap.scrollLeft = ps.scrollLeft - (e.clientX - ps.startX)
    wrap.scrollTop = ps.scrollTop - (e.clientY - ps.startY)
  }

  function onPanEnd() {
    panState.current.isPanning = false
    if (wrapRef.current) wrapRef.current.style.cursor = 'grab'
  }

  function onDragStart(e, task) {
    if (!canMove(task)) { e.preventDefault(); return }
    setDraggingId(task.id)
    e.dataTransfer.effectAllowed = 'move'
    // Firefox refuses to start a drag without payload.
    try { e.dataTransfer.setData('text/plain', task.id) } catch {}
  }

  function onDragOver(e, status) {
    if (!draggingId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (overStatus !== status) setOverStatus(status)
  }

  function onDrop(e, status) {
    e.preventDefault()
    const task = byId.get(draggingId)
    setDraggingId(null)
    setOverStatus(null)
    if (task) moveTask(task, status)
  }

  function onDragEnd() {
    setDraggingId(null)
    setOverStatus(null)
  }

  // One card, plus whatever nests under it in this column — the same shape the
  // project board draws, so a story and its sub-tasks read the same on both.
  function renderCard(task, col, depth) {
    const d = depth || 0
    // Shown only when the parent is not drawn above this card here: either it is in
    // another column, or it was never added to the sprint. Either way it is the one
    // thing about a loose sub-task you cannot guess, and it opens on click.
    const crumbParent = d === 0 && task.parentId ? projectById.get(task.parentId) : null
    const kids = kidsOf.get(task.id) || []
    const doneKids = kids.filter(k => k.status === 'done').length
    const nested = childrenInCol(task.id, col.status)
    const ac = acceptanceProgress(task)
    const movable = canMove(task)
    const names = assigneeNames(task)
    return (
      <div key={task.id} className="sprint-card-group">
        <div
          className={`sprint-card${d > 0 ? ' sprint-card--child' : ''}${draggingId === task.id ? ' sprint-card--dragging' : ''}${movable ? '' : ' sprint-card--locked'}`}
          draggable={movable}
          role="button"
          tabIndex={0}
          title={movable ? 'Drag to move · click to edit' : 'Click to open — you can only move cards assigned to you'}
          onDragStart={e => onDragStart(e, task)}
          onDragEnd={onDragEnd}
          onClick={() => openCard(task)}
          onKeyDown={e => { if (e.key === 'Enter') openCard(task) }}
        >
          {crumbParent && (
            <div
              className="sprint-card-crumb"
              role="button"
              tabIndex={0}
              title={`Parent: ${crumbParent.title}${byId.has(crumbParent.id) ? '' : ' (not in this sprint)'} — click to open`}
              onClick={e => { e.stopPropagation(); openCard(crumbParent) }}
              onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); openCard(crumbParent) } }}
            >
              ↳ {crumbParent.title}
            </div>
          )}
          <div className="sprint-card-top">
            {d > 0 && <span className="sprint-sub-badge" title="Sub-task">↳ sub</span>}
            {(task.seq != null || task.number) && (
              <span className="task-id-badge" style={{ fontSize: 9 }}>
                {task.seq != null ? (taskPrefix ? `${taskPrefix}-${task.seq}` : `#${task.seq}`) : `#${task.number}`}
              </span>
            )}
            {task.priority && (
              <span
                className="sprint-card-prio"
                style={{ background: PRIORITY_COLOR[task.priority] }}
                title={`${PRIORITY_LABEL[task.priority]} priority`}
              />
            )}
            {names.slice(0, 3).map(a => (
              <span key={a} className="kanban-assignee-avatar sprint-card-avatar" title={a}>
                {a.charAt(0).toUpperCase()}
              </span>
            ))}
          </div>
          <div className="sprint-card-title">{task.title}</div>
          <div className="sprint-card-meta">
            {Number(task.points) > 0 && (
              <span className="task-meta-chip" title="Story points">{Number(task.points)}p</span>
            )}
            {task.dueDate && (
              <span className={`task-meta-chip${isOverdue(task.dueDate) ? ' task-due' : ''}`}>
                {isOverdue(task.dueDate) ? '⚠ ' : ''}{formatDate(task.dueDate)}
              </span>
            )}
            {kids.length > 0 && (
              <span className="task-meta-chip" title="Sub-tasks in this sprint">{doneKids}/{kids.length} sub</span>
            )}
            {ac.total > 0 && (
              <span
                className={`task-meta-chip task-ac-chip${ac.met === ac.total ? ' task-ac-chip--met' : ''}`}
                title={`Acceptance criteria: ${ac.met} of ${ac.total} met`}
              >✓ {ac.met}/{ac.total}</span>
            )}
          </div>
          {movable && (
            // The keyboard and touch path to the same move — dragging is the fast
            // gesture, not the only one.
            <select
              className="sprint-card-move"
              value={task.status || 'todo'}
              onClick={e => e.stopPropagation()}
              onChange={e => { e.stopPropagation(); moveTask(task, e.target.value) }}
              aria-label={`Move “${task.title}”`}
            >
              {columns.map(c => (
                <option key={c.status} value={c.status} disabled={!statusAllowedForUser(c.status)}>
                  {c.label}
                </option>
              ))}
            </select>
          )}
        </div>

        {nested.length > 0 && (
          <div className="sprint-child-cards">
            {nested.map(kid => renderCard(kid, col, d + 1))}
          </div>
        )}
      </div>
    )
  }

  if (!tasks.length) return null

  return (
    <>
    <div
      ref={wrapRef}
      className="sprint-board-wrap"
      onMouseDown={onPanStart}
      onMouseMove={onPanMove}
      onMouseUp={onPanEnd}
      onMouseLeave={onPanEnd}
    >
      <div className="sprint-board">
        {columns.map(col => {
          const cards = colTasks(col.status)
          const inCol = allInCol(col.status)
          const pts = pointsOf(inCol)
          return (
            <div
              key={col.status}
              className={`sprint-col${overStatus === col.status ? ' sprint-col--over' : ''}`}
              style={{ '--status-color': col.color }}
              onDragOver={e => onDragOver(e, col.status)}
              onDrop={e => onDrop(e, col.status)}
            >
              <div className="sprint-col-head">
                <span className="kanban-column-dot" style={{ background: col.color }} />
                <span className="sprint-col-title">{col.label}</span>
                <span className="sprint-col-count">{inCol.length}</span>
                {hasPoints && pts > 0 && <span className="sprint-col-pts">{pts}p</span>}
              </div>
              <div className="sprint-col-cards">
                {inCol.length === 0 && <p className="sprint-col-empty">—</p>}
                {cards.map(task => renderCard(task, col, 0))}
              </div>
            </div>
          )
        })}
      </div>
    </div>

    {editing && (
      <div
        className="kanban-modal-overlay"
        onClick={e => { if (e.target === e.currentTarget) setEditingId(null) }}
      >
        <div className="kanban-modal">
          <div className="kanban-modal-header">
            <div className="sprint-edit-title">
              {(editing.seq != null || editing.number) && (
                <span className="task-id-badge">
                  {editing.seq != null ? (taskPrefix ? `${taskPrefix}-${editing.seq}` : `#${editing.seq}`) : `#${editing.number}`}
                </span>
              )}
              <span className="sprint-edit-title-text">{editing.title}</span>
            </div>
            <button className="kanban-modal-close" onClick={() => setEditingId(null)} title="Close (Esc)">✕</button>
          </div>
          <div className="sprint-edit-body">
            {canEditCard ? (
              // The same composer the list and the board use, so a story is edited
              // with the same fields wherever it is opened from. Keyed by task id so
              // opening a second card rebuilds the form instead of keeping the first
              // one's values.
              <TaskForm
                key={editing.id}
                initial={toEditForm(editing)}
                columns={columns}
                categories={categories}
                assignees={assignees}
                labels={labels}
                label="Save"
                onSave={saveEdit}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              // No edit rights: the card still opens, it just shows what it is and
              // offers the one change this user may make.
              <div className="sprint-edit-read">
                <p className={`sprint-edit-desc${editing.description ? '' : ' sprint-edit-desc--empty'}`}>
                  {editing.description || 'No description.'}
                </p>
                {canMove(editing) && (
                  <label className="sprint-edit-status">
                    <span>Status</span>
                    <select
                      className="form-input"
                      value={editing.status || 'todo'}
                      onChange={e => moveTask(editing, e.target.value)}
                    >
                      {columns.map(c => (
                        <option key={c.status} value={c.status} disabled={!statusAllowedForUser(c.status)}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            )}
            <Link href={fullCardHref(editing)} className="sprint-edit-full">
              Open full card ↗
            </Link>
          </div>
        </div>
      </div>
    )}
    </>
  )
}
