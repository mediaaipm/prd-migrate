import { useState, useEffect, useRef } from 'react'
import { apiFetch } from '../lib/api-fetch'

const COLUMNS = [
  { status: 'backlog',     label: 'Backlog',      color: '#94a3b8' },
  { status: 'todo',        label: 'To Do',        color: '#3b82f6' },
  { status: 'in-progress', label: 'In Progress',  color: '#f59e0b' },
  { status: 'in-review',   label: 'In Review',    color: '#8b5cf6' },
  { status: 'done',        label: 'Done',         color: '#16a34a' },
]

const PRIORITY_COLOR = { low: '#64748b', medium: '#f59e0b', high: '#dc2626' }
const PRIORITY_LABEL = { low: 'Low', medium: 'Med', high: 'High' }

function isOverdue(dueDate) {
  if (!dueDate) return false
  return new Date(dueDate) < new Date()
}

function formatDate(d) {
  if (!d) return null
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function toEditForm(task) {
  return {
    title: task.title || '',
    description: task.description || '',
    status: task.status || 'todo',
    priority: task.priority || 'medium',
    assignees: task.assignees || [],
    startDate: task.startDate ? task.startDate.slice(0, 10) : '',
    dueDate: task.dueDate ? task.dueDate.slice(0, 10) : '',
  }
}

export default function KanbanBoard({ tasks, apiBase, onRefresh }) {
  const [draggingId, setDraggingId] = useState(null)
  const [dragOverStatus, setDragOverStatus] = useState(null)
  const [addingFor, setAddingFor] = useState(null)
  const [addForm, setAddForm] = useState(null)
  const [editingTask, setEditingTask] = useState(null)
  const [editForm, setEditForm] = useState(null)
  const [assignees, setAssignees] = useState([])
  const [saving, setSaving] = useState(false)
  const [animatingOut, setAnimatingOut] = useState(new Set())

  const boardWrapperRef = useRef(null)
  const panState = useRef({ isPanning: false, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0 })

  const taskById = Object.fromEntries(tasks.map(t => [t.id, t]))
  const STATUS_CYCLE = {
    'backlog': 'todo',
    'todo': 'in-progress',
    'in-progress': 'in-review',
    'in-review': 'done',
    'done': 'backlog',
  }

  function onBoardMouseDown(e) {
    if (e.target.closest('.kanban-card') || e.target.closest('.kanban-subtask-row') ||
        e.target.closest('button') || e.target.closest('input') || e.target.closest('select')) return
    const wrapper = boardWrapperRef.current
    if (!wrapper) return
    panState.current = {
      isPanning: true,
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: wrapper.scrollLeft,
      scrollTop: wrapper.scrollTop,
    }
    wrapper.style.cursor = 'grabbing'
    e.preventDefault()
  }

  function onBoardMouseMove(e) {
    const ps = panState.current
    if (!ps.isPanning) return
    const wrapper = boardWrapperRef.current
    if (!wrapper) return
    wrapper.scrollLeft = ps.scrollLeft - (e.clientX - ps.startX)
    wrapper.scrollTop  = ps.scrollTop  - (e.clientY - ps.startY)
  }

  function onBoardMouseUp() {
    panState.current.isPanning = false
    if (boardWrapperRef.current) boardWrapperRef.current.style.cursor = 'grab'
  }

  async function cycleStatus(task, e) {
    e.stopPropagation()
    await updateStatus(task.id, STATUS_CYCLE[task.status] || 'todo')
  }

  useEffect(() => {
    fetch('/api/assignees')
      .then(r => r.ok ? r.json() : [])
      .then(setAssignees)
      .catch(() => {})
  }, [])

  function startAdding(status) {
    setAddingFor(status)
    setAddForm({ title: '', status, priority: 'medium' })
  }

  async function saveNew() {
    if (!addForm?.title.trim()) return
    setSaving(true)
    await apiFetch(apiBase, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(addForm),
    })
    setSaving(false)
    setAddingFor(null)
    setAddForm(null)
    onRefresh()
  }

  function openEdit(task) {
    setEditingTask(task)
    setEditForm(toEditForm(task))
  }

  function closeEdit() {
    setEditingTask(null)
    setEditForm(null)
  }

  async function saveEdit() {
    if (!editForm?.title.trim() || !editingTask) return
    setSaving(true)
    await apiFetch(`${apiBase}/${editingTask.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editForm),
    })
    setSaving(false)
    closeEdit()
    onRefresh()
  }

  async function updateStatus(taskId, newStatus) {
    const task = tasks.find(t => t.id === taskId)
    if (!task || task.status === newStatus) return
    setAnimatingOut(prev => new Set([...prev, taskId]))
    await Promise.all([
      apiFetch(`${apiBase}/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      }),
      new Promise(r => setTimeout(r, 180)),
    ])
    setAnimatingOut(prev => { const s = new Set(prev); s.delete(taskId); return s })
    onRefresh()
  }

  function onDragStart(e, taskId) {
    setDraggingId(taskId)
    e.dataTransfer.effectAllowed = 'move'
    e.stopPropagation()
  }

  function onDragOver(e, status) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverStatus(status)
  }

  function onDrop(e, status) {
    e.preventDefault()
    if (draggingId) updateStatus(draggingId, status)
    setDraggingId(null)
    setDragOverStatus(null)
  }

  function onDragEnd() {
    setDraggingId(null)
    setDragOverStatus(null)
  }

  function toggleEditAssignee(name) {
    setEditForm(p => ({
      ...p,
      assignees: p.assignees.includes(name)
        ? p.assignees.filter(a => a !== name)
        : [...p.assignees, name],
    }))
  }

  function getColTasks(status) {
    return tasks.filter(t => !t.parentId && t.status === status).sort((a, b) => a.order - b.order)
  }

  function getChildrenOf(taskId) {
    return tasks.filter(t => t.parentId === taskId).sort((a, b) => a.order - b.order)
  }

  // Children of taskId that share the same status as the column (shown nested under parent)
  function getChildrenInCol(taskId, colStatus) {
    return tasks.filter(t => t.parentId === taskId && t.status === colStatus).sort((a, b) => a.order - b.order)
  }

  // Subtasks in this column whose parent is in a different column
  function getOrphanSubsInCol(colStatus) {
    return tasks
      .filter(t => t.parentId && t.status === colStatus && taskById[t.parentId]?.status !== colStatus)
      .sort((a, b) => a.order - b.order)
  }

  return (
    <div>
      <div
        ref={boardWrapperRef}
        className="kanban-board-wrapper"
        onMouseDown={onBoardMouseDown}
        onMouseMove={onBoardMouseMove}
        onMouseUp={onBoardMouseUp}
        onMouseLeave={onBoardMouseUp}
      >
      <div className="kanban-board">
        {COLUMNS.map(col => {
          const colTasks = getColTasks(col.status)
          return (
            <div
              key={col.status}
              className={`kanban-column${dragOverStatus === col.status ? ' kanban-column--drag-over' : ''}`}
              onDragOver={e => onDragOver(e, col.status)}
              onDrop={e => onDrop(e, col.status)}
              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverStatus(null) }}
            >
              <div className="kanban-column-header">
                <div className="kanban-column-title">
                  <span className="kanban-column-dot" style={{ background: col.color }} />
                  <span>{col.label}</span>
                  <span className="kanban-column-count">{tasks.filter(t => t.status === col.status).length}</span>
                </div>
                <button
                  className="kanban-add-btn"
                  onClick={() => addingFor === col.status ? setAddingFor(null) : startAdding(col.status)}
                  title={`Add task to ${col.label}`}
                >+</button>
              </div>

              {addingFor === col.status && addForm && (
                <div className="kanban-add-form">
                  <input
                    className="form-input"
                    placeholder="Task title *"
                    value={addForm.title}
                    onChange={e => setAddForm(p => ({ ...p, title: e.target.value }))}
                    autoFocus
                    onKeyDown={e => {
                      if (e.key === 'Enter') saveNew()
                      if (e.key === 'Escape') setAddingFor(null)
                    }}
                  />
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <select
                      className="form-input"
                      value={addForm.priority}
                      onChange={e => setAddForm(p => ({ ...p, priority: e.target.value }))}
                      style={{ flex: 1 }}
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                    <button className="btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => setAddingFor(null)}>Cancel</button>
                    <button
                      className="btn-primary"
                      style={{ fontSize: 12, padding: '4px 10px' }}
                      onClick={saveNew}
                      disabled={saving || !addForm.title.trim()}
                    >Add</button>
                  </div>
                </div>
              )}

              <div className="kanban-cards">
                {colTasks.map(task => {
                  const allChildren = getChildrenOf(task.id)
                  const sameColChildren = getChildrenInCol(task.id, col.status)
                  const doneChildren = allChildren.filter(c => c.status === 'done').length
                  const overdue = isOverdue(task.dueDate)
                  return (
                    <div key={task.id} className={`kanban-card-group${animatingOut.has(task.id) ? ' kanban-card-group--leaving' : ''}`}>
                      <div
                        className={`kanban-card${draggingId === task.id ? ' kanban-card--dragging' : ''}`}
                        draggable
                        onDragStart={e => onDragStart(e, task.id)}
                        onDragEnd={onDragEnd}
                      >
                        <div className="kanban-card-header">
                          {task.number && <span className="task-number" style={{ fontSize: 10 }}>{task.number}</span>}
                          <button
                            className="kanban-card-edit-btn"
                            onClick={() => openEdit(task)}
                            title="Edit task"
                          >✎</button>
                        </div>
                        <div className="kanban-card-title">{task.title}</div>
                        <div className="kanban-card-meta">
                          {task.priority && (
                            <span
                              className="task-meta-chip"
                              style={{
                                color: PRIORITY_COLOR[task.priority],
                                borderColor: `${PRIORITY_COLOR[task.priority]}44`,
                                background: `${PRIORITY_COLOR[task.priority]}11`,
                              }}
                            >
                              {PRIORITY_LABEL[task.priority]}
                            </span>
                          )}
                          {task.dueDate && (
                            <span className={`task-meta-chip${overdue ? ' task-due' : ''}`}>
                              {overdue ? '⚠ ' : ''}{formatDate(task.dueDate)}
                            </span>
                          )}
                          {allChildren.length > 0 && (
                            <span className="task-meta-chip kanban-progress-chip">
                              {doneChildren}/{allChildren.length} sub
                            </span>
                          )}
                          {task.assignees?.map(a => (
                            <span key={a} className="kanban-assignee-avatar" title={a}>
                              {a.charAt(0).toUpperCase()}
                            </span>
                          ))}
                        </div>
                      </div>

                      {sameColChildren.length > 0 && (
                        <div className="kanban-subtasks">
                          {sameColChildren.map(sub => {
                            const subOverdue = isOverdue(sub.dueDate)
                            const statusCol = COLUMNS.find(c => c.status === sub.status)
                            return (
                              <div
                                key={sub.id}
                                className={`kanban-subtask-row${draggingId === sub.id ? ' kanban-card--dragging' : ''}`}
                                draggable
                                onDragStart={e => onDragStart(e, sub.id)}
                                onDragEnd={onDragEnd}
                              >
                                <span className="kanban-subtask-title">{sub.number ? <span className="task-number" style={{ fontSize: 9, marginRight: 3 }}>{sub.number}</span> : null}{sub.title}</span>
                                <span className="kanban-subtask-actions">
                                  {sub.priority && (
                                    <span
                                      className="task-meta-chip"
                                      style={{
                                        fontSize: 9,
                                        padding: '1px 4px',
                                        color: PRIORITY_COLOR[sub.priority],
                                        borderColor: `${PRIORITY_COLOR[sub.priority]}44`,
                                        background: `${PRIORITY_COLOR[sub.priority]}11`,
                                      }}
                                    >
                                      {PRIORITY_LABEL[sub.priority]}
                                    </span>
                                  )}
                                  {sub.dueDate && (
                                    <span className={`task-meta-chip${subOverdue ? ' task-due' : ''}`} style={{ fontSize: 9, padding: '1px 4px' }}>
                                      {subOverdue ? '⚠ ' : ''}{formatDate(sub.dueDate)}
                                    </span>
                                  )}
                                  <select
                                    className="kanban-subtask-status-select"
                                    style={{ '--status-color': statusCol?.color || '#64748b' }}
                                    value={sub.status}
                                    onClick={e => e.stopPropagation()}
                                    onChange={e => { e.stopPropagation(); updateStatus(sub.id, e.target.value) }}
                                  >
                                    {COLUMNS.map(c => (
                                      <option key={c.status} value={c.status}>{c.label}</option>
                                    ))}
                                  </select>
                                  <button
                                    className="kanban-card-edit-btn"
                                    style={{ fontSize: 10, padding: '1px 4px' }}
                                    onClick={() => openEdit(sub)}
                                    title="Edit subtask"
                                  >✎</button>
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}

                {getOrphanSubsInCol(col.status).map(sub => {
                  const parent = taskById[sub.parentId]
                  const subOverdue = isOverdue(sub.dueDate)
                  const statusCol = COLUMNS.find(c => c.status === sub.status)
                  return (
                    <div key={sub.id} className={`kanban-card-group${animatingOut.has(sub.id) ? ' kanban-card-group--leaving' : ''}`}>
                      {parent && (
                        <div className="kanban-subtask-parent-label">
                          ↳ {parent.number ? <span className="task-number" style={{ fontSize: 9, marginRight: 2 }}>{parent.number}</span> : null}{parent.title}
                        </div>
                      )}
                      <div
                        className={`kanban-subtask-row kanban-subtask-row--orphan${draggingId === sub.id ? ' kanban-card--dragging' : ''}`}
                        draggable
                        onDragStart={e => onDragStart(e, sub.id)}
                        onDragEnd={onDragEnd}
                      >
                        <span className="kanban-subtask-title">
                          {sub.number ? <span className="task-number" style={{ fontSize: 9, marginRight: 3 }}>{sub.number}</span> : null}
                          {sub.title}
                        </span>
                        <span className="kanban-subtask-actions">
                          {sub.priority && (
                            <span
                              className="task-meta-chip"
                              style={{
                                fontSize: 9,
                                padding: '1px 4px',
                                color: PRIORITY_COLOR[sub.priority],
                                borderColor: `${PRIORITY_COLOR[sub.priority]}44`,
                                background: `${PRIORITY_COLOR[sub.priority]}11`,
                              }}
                            >
                              {PRIORITY_LABEL[sub.priority]}
                            </span>
                          )}
                          {sub.dueDate && (
                            <span className={`task-meta-chip${subOverdue ? ' task-due' : ''}`} style={{ fontSize: 9, padding: '1px 4px' }}>
                              {subOverdue ? '⚠ ' : ''}{formatDate(sub.dueDate)}
                            </span>
                          )}
                          <select
                            className="kanban-subtask-status-select"
                            style={{ '--status-color': statusCol?.color || '#64748b' }}
                            value={sub.status}
                            onClick={e => e.stopPropagation()}
                            onChange={e => { e.stopPropagation(); updateStatus(sub.id, e.target.value) }}
                          >
                            {COLUMNS.map(c => (
                              <option key={c.status} value={c.status}>{c.label}</option>
                            ))}
                          </select>
                          <button
                            className="kanban-card-edit-btn"
                            style={{ fontSize: 10, padding: '1px 4px' }}
                            onClick={() => openEdit(sub)}
                            title="Edit subtask"
                          >✎</button>
                        </span>
                      </div>
                    </div>
                  )
                })}

                {tasks.filter(t => t.status === col.status).length === 0 && addingFor !== col.status && (
                  <div className="kanban-empty">No tasks</div>
                )}
              </div>
            </div>
          )
        })}
      </div>
      </div>

      {editingTask && editForm && (
        <div
          className="kanban-modal-overlay"
          onClick={e => { if (e.target === e.currentTarget) closeEdit() }}
        >
          <div className="kanban-modal">
            <div className="kanban-modal-header">
              <span>Edit Task</span>
              <button className="kanban-modal-close" onClick={closeEdit}>✕</button>
            </div>
            <div className="task-form">
              <input
                className="form-input"
                placeholder="Title *"
                value={editForm.title}
                onChange={e => setEditForm(p => ({ ...p, title: e.target.value }))}
                autoFocus
              />
              <textarea
                className="form-input task-desc-input"
                placeholder="Description (optional)"
                value={editForm.description}
                onChange={e => setEditForm(p => ({ ...p, description: e.target.value }))}
                rows={2}
              />
              <div className="task-form-row">
                <select className="form-input" value={editForm.status} onChange={e => setEditForm(p => ({ ...p, status: e.target.value }))}>
                  {COLUMNS.map(c => (
                    <option key={c.status} value={c.status}>{c.label}</option>
                  ))}
                </select>
                <select className="form-input" value={editForm.priority} onChange={e => setEditForm(p => ({ ...p, priority: e.target.value }))}>
                  <option value="low">Low priority</option>
                  <option value="medium">Medium priority</option>
                  <option value="high">High priority</option>
                </select>
              </div>
              {assignees.length > 0 && (
                <div className="task-assignees-selector">
                  <span className="task-assignees-label">Assignees:</span>
                  <div className="task-assignees-list">
                    {assignees.map(a => (
                      <label
                        key={a.name}
                        className={`task-assignee-chip ${editForm.assignees.includes(a.name) ? 'selected' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={editForm.assignees.includes(a.name)}
                          onChange={() => toggleEditAssignee(a.name)}
                        />
                        {a.name}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <div className="task-form-row">
                <input
                  className="form-input"
                  type="date"
                  title="Start date"
                  value={editForm.startDate}
                  onChange={e => setEditForm(p => ({ ...p, startDate: e.target.value }))}
                />
                <input
                  className="form-input"
                  type="date"
                  title="Due date"
                  value={editForm.dueDate}
                  onChange={e => setEditForm(p => ({ ...p, dueDate: e.target.value }))}
                />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                <button className="btn-ghost" onClick={closeEdit}>Cancel</button>
                <button
                  className="btn-primary"
                  onClick={saveEdit}
                  disabled={saving || !editForm.title.trim()}
                >Save</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
