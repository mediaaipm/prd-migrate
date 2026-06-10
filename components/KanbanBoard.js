import { useState, useEffect, useRef } from 'react'
import { apiFetch } from '../lib/api-fetch'

const DEFAULT_COLUMNS = [
  { status: 'backlog',     label: 'Backlog',      color: '#94a3b8' },
  { status: 'todo',        label: 'To Do',        color: '#3b82f6' },
  { status: 'in-progress', label: 'In Progress',  color: '#f59e0b' },
  { status: 'in-review',   label: 'In Review',    color: '#8b5cf6' },
  { status: 'done',        label: 'Done',         color: '#16a34a' },
]

const COL_COLORS = [
  '#94a3b8','#3b82f6','#f59e0b','#8b5cf6','#16a34a',
  '#ef4444','#ec4899','#06b6d4','#f97316','#84cc16',
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

function updateAtPath(tree, path, updater) {
  if (path.length === 0) return updater(tree)
  const [head, ...rest] = path
  const newChildren = [...tree.children]
  newChildren[head] = updateAtPath(newChildren[head], rest, updater)
  return { ...tree, children: newChildren }
}

function slugify(label, existingStatuses) {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'col'
  const set = new Set(existingStatuses)
  if (!set.has(base)) return base
  let i = 2
  while (set.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

export default function KanbanBoard({ tasks, apiBase, onRefresh }) {
  const storageKey = `kanban-cols:${apiBase}`

  const [columns, setColumns] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_COLUMNS
    try {
      const saved = localStorage.getItem(`kanban-cols:${apiBase}`)
      if (saved) return JSON.parse(saved)
    } catch {}
    return DEFAULT_COLUMNS
  })

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(columns)) } catch {}
  }, [columns, storageKey])

  const [draggingId, setDraggingId] = useState(null)
  const [dragOverStatus, setDragOverStatus] = useState(null)
  const [addingFor, setAddingFor] = useState(null)
  const [addForm, setAddForm] = useState(null)
  const [editingTask, setEditingTask] = useState(null)
  const [editForm, setEditForm] = useState(null)
  const [assignees, setAssignees] = useState([])
  const [saving, setSaving] = useState(false)
  const [animatingOut, setAnimatingOut] = useState(new Set())
  const [kbSearch, setKbSearch] = useState('')
  const [kbPriority, setKbPriority] = useState('')
  const [kbStatus, setKbStatus] = useState('')
  const [kbDate, setKbDate] = useState('')
  const [kbPerson, setKbPerson] = useState('')

  // Column management
  const [addingCol, setAddingCol] = useState(false)
  const [newColForm, setNewColForm] = useState({ label: '', color: COL_COLORS[0] })
  const [editingColStatus, setEditingColStatus] = useState(null)
  const [editingColLabel, setEditingColLabel] = useState('')
  const [draggingColStatus, setDraggingColStatus] = useState(null)
  const [dragOverColStatus, setDragOverColStatus] = useState(null)

  const dragTypeRef = useRef(null)
  const boardWrapperRef = useRef(null)
  const panState = useRef({ isPanning: false, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0 })

  const taskById = Object.fromEntries(tasks.map(t => [t.id, t]))

  const STATUS_CYCLE = Object.fromEntries(
    columns.map((col, i) => [col.status, columns[(i + 1) % columns.length].status])
  )

  function matchesFilters(t) {
    const sq = kbSearch.toLowerCase()
    if (sq && !t.title.toLowerCase().includes(sq)) return false
    if (kbPriority && (t.priority || 'medium') !== kbPriority) return false
    if (kbStatus && t.status !== kbStatus) return false
    if (kbPerson) {
      const pq = kbPerson.toLowerCase().trim()
      const ta = Array.isArray(t.assignees) ? t.assignees : []
      if (!ta.some(a => a.toLowerCase().includes(pq))) return false
    }
    if (kbDate) {
      const now = new Date()
      const due = t.dueDate ? new Date(t.dueDate) : null
      if (kbDate === 'overdue' && (!due || due >= now)) return false
      if (kbDate === 'this-week') {
        const weekEnd = new Date(now); weekEnd.setDate(now.getDate() + 7)
        if (!due || due < now || due > weekEnd) return false
      }
      if (kbDate === 'this-month') {
        const monthEnd = new Date(now); monthEnd.setDate(now.getDate() + 30)
        if (!due || due < now || due > monthEnd) return false
      }
      if (kbDate === 'no-date' && due) return false
    }
    return true
  }

  const hasKbFilters = kbSearch || kbPriority || kbStatus || kbDate || kbPerson
  const visibleTasks = hasKbFilters ? tasks.filter(matchesFilters) : tasks
  const visibleIds = new Set(visibleTasks.map(t => t.id))

  function onBoardMouseDown(e) {
    if (e.target.closest('.kanban-card') || e.target.closest('.kanban-subtask-row') ||
        e.target.closest('button') || e.target.closest('input') || e.target.closest('select') ||
        e.target.closest('.kanban-column-header')) return
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
    await updateStatus(task.id, STATUS_CYCLE[task.status] || columns[0]?.status || 'todo')
  }

  useEffect(() => {
    fetch('/api/assignees')
      .then(r => r.ok ? r.json() : [])
      .then(setAssignees)
      .catch(() => {})
  }, [])

  function startAdding(status) {
    setAddingFor(status)
    setAddForm({ title: '', status, priority: 'medium', children: [] })
  }

  async function saveNew() {
    if (!addForm?.title.trim()) return
    setSaving(true)
    const status = addForm.status
    async function createTree(node, parentId) {
      const res = await apiFetch(apiBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: node.title.trim(),
          priority: node.priority || 'medium',
          status,
          ...(parentId ? { parentId } : {}),
        }),
      })
      const created = await res.json()
      for (const child of (node.children || [])) {
        if (child.title.trim()) await createTree(child, created.id)
      }
    }
    await createTree(addForm, null)
    setSaving(false)
    setAddingFor(null)
    setAddForm(null)
    onRefresh()
  }

  function renderSubFormChildren(children, path) {
    return children.map((child, idx) => (
      <div key={child._lid} className="kanban-add-subtask-block" style={{ paddingLeft: (path.length + 1) * 14 }}>
        <div className="kanban-add-subtask-row">
          <span className="kanban-subtask-indent-arrow">↳</span>
          <input
            className="form-input kanban-add-subtask-input"
            placeholder="Subtask title"
            value={child.title}
            autoFocus
            onChange={e => setAddForm(f => updateAtPath(f, [...path, idx], n => ({ ...n, title: e.target.value })))}
            onKeyDown={e => { if (e.key === 'Escape') setAddingFor(null) }}
          />
          <select
            className="form-input kanban-add-subtask-priority"
            value={child.priority}
            onChange={e => setAddForm(f => updateAtPath(f, [...path, idx], n => ({ ...n, priority: e.target.value })))}
          >
            <option value="low">Low</option>
            <option value="medium">Med</option>
            <option value="high">High</option>
          </select>
          <button
            className="btn-ghost kanban-add-subtask-remove"
            onClick={() => setAddForm(f => updateAtPath(f, path, n => ({ ...n, children: n.children.filter((_, i) => i !== idx) })))}
            title="Remove"
          >✕</button>
        </div>
        {renderSubFormChildren(child.children, [...path, idx])}
        <button
          className="kanban-add-subtask-btn kanban-add-subtask-btn--nested"
          onClick={() => setAddForm(f => updateAtPath(f, [...path, idx], n => ({ ...n, children: [...(n.children || []), { _lid: Date.now() + Math.random(), title: '', priority: 'medium', children: [] }] })))}
        >+ Add sub-task</button>
      </div>
    ))
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

  // Task drag
  function onDragStart(e, taskId) {
    dragTypeRef.current = 'task'
    setDraggingId(taskId)
    e.dataTransfer.effectAllowed = 'move'
    e.stopPropagation()
  }

  function onDragOver(e, status) {
    if (dragTypeRef.current !== 'task') return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverStatus(status)
  }

  function onDrop(e, status) {
    if (dragTypeRef.current !== 'task') return
    e.preventDefault()
    if (draggingId) updateStatus(draggingId, status)
    setDraggingId(null)
    setDragOverStatus(null)
    dragTypeRef.current = null
  }

  function onDragEnd() {
    setDraggingId(null)
    setDragOverStatus(null)
    setDraggingColStatus(null)
    setDragOverColStatus(null)
    dragTypeRef.current = null
  }

  // Column drag (reorder)
  function onColDragStart(e, status) {
    dragTypeRef.current = 'col'
    setDraggingColStatus(status)
    e.dataTransfer.effectAllowed = 'move'
    e.stopPropagation()
  }

  function onColDragOver(e, status) {
    if (dragTypeRef.current !== 'col') return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverColStatus(status)
  }

  function onColDrop(e, toStatus) {
    if (dragTypeRef.current !== 'col') return
    e.preventDefault()
    if (draggingColStatus && draggingColStatus !== toStatus) {
      setColumns(prev => {
        const arr = [...prev]
        const fromIdx = arr.findIndex(c => c.status === draggingColStatus)
        const toIdx = arr.findIndex(c => c.status === toStatus)
        if (fromIdx === -1 || toIdx === -1) return prev
        const [col] = arr.splice(fromIdx, 1)
        arr.splice(toIdx, 0, col)
        return arr
      })
    }
    setDraggingColStatus(null)
    setDragOverColStatus(null)
    dragTypeRef.current = null
  }

  // Column CRUD
  function addColumn() {
    if (!newColForm.label.trim()) return
    const status = slugify(newColForm.label.trim(), columns.map(c => c.status))
    setColumns(prev => [...prev, { status, label: newColForm.label.trim(), color: newColForm.color }])
    setNewColForm({ label: '', color: COL_COLORS[0] })
    setAddingCol(false)
  }

  function startRenameCol(status, currentLabel) {
    setEditingColStatus(status)
    setEditingColLabel(currentLabel)
  }

  function commitRenameCol(status) {
    if (editingColLabel.trim()) {
      setColumns(prev => prev.map(c => c.status === status ? { ...c, label: editingColLabel.trim() } : c))
    }
    setEditingColStatus(null)
    setEditingColLabel('')
  }

  function changeColColor(status, color) {
    setColumns(prev => prev.map(c => c.status === status ? { ...c, color } : c))
  }

  function deleteColumn(status) {
    const taskCount = tasks.filter(t => t.status === status).length
    if (taskCount > 0) {
      alert(`Cannot delete: ${taskCount} task${taskCount !== 1 ? 's' : ''} in this column. Move them first.`)
      return
    }
    setColumns(prev => prev.filter(c => c.status !== status))
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
    return visibleTasks.filter(t => !t.parentId && t.status === status).sort((a, b) => a.order - b.order)
  }

  function getChildrenOf(taskId) {
    return tasks.filter(t => t.parentId === taskId).sort((a, b) => a.order - b.order)
  }

  function getChildrenInCol(taskId, colStatus) {
    return visibleTasks.filter(t => t.parentId === taskId && t.status === colStatus).sort((a, b) => a.order - b.order)
  }

  function getOrphanSubsInCol(colStatus) {
    return visibleTasks
      .filter(t => t.parentId && t.status === colStatus && taskById[t.parentId]?.status !== colStatus)
      .sort((a, b) => a.order - b.order)
  }

  return (
    <div>
      <div className="kanban-filter-bar">
        <div className="search-bar" style={{ flex: 1, minWidth: 160 }}>
          <input
            className="form-input search-input"
            placeholder="Search tasks…"
            value={kbSearch}
            onChange={e => setKbSearch(e.target.value)}
          />
          {kbSearch && (
            <button className="btn-ghost search-clear" onClick={() => setKbSearch('')} title="Clear">&#x2715;</button>
          )}
        </div>
        <select className="form-input filter-select" value={kbPriority} onChange={e => setKbPriority(e.target.value)}>
          <option value="">All priorities</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select className="form-input filter-select" value={kbStatus} onChange={e => setKbStatus(e.target.value)}>
          <option value="">All statuses</option>
          {columns.map(c => <option key={c.status} value={c.status}>{c.label}</option>)}
        </select>
        <select className="form-input filter-select" value={kbDate} onChange={e => setKbDate(e.target.value)}>
          <option value="">All dates</option>
          <option value="overdue">Overdue</option>
          <option value="this-week">Due this week</option>
          <option value="this-month">Due this month</option>
          <option value="no-date">No due date</option>
        </select>
        {assignees.length > 0 && (
          <div className="search-bar" style={{ marginBottom: 0, minWidth: 140, maxWidth: 180 }}>
            <input
              className="form-input search-input"
              list="kb-assignee-list"
              placeholder="Filter by person…"
              value={kbPerson}
              onChange={e => setKbPerson(e.target.value)}
              style={{ fontSize: 12, padding: '5px 28px 5px 10px' }}
            />
            {kbPerson && (
              <button className="btn-ghost search-clear" onClick={() => setKbPerson('')} title="Clear">&#x2715;</button>
            )}
            <datalist id="kb-assignee-list">
              {assignees.map(a => <option key={a.name} value={a.name} />)}
            </datalist>
          </div>
        )}
        {hasKbFilters && (
          <button className="btn-ghost" style={{ whiteSpace: 'nowrap', fontSize: 12 }} onClick={() => { setKbSearch(''); setKbPriority(''); setKbStatus(''); setKbDate(''); setKbPerson('') }}>
            Clear filters
          </button>
        )}
      </div>
      <div
        ref={boardWrapperRef}
        className="kanban-board-wrapper"
        onMouseDown={onBoardMouseDown}
        onMouseMove={onBoardMouseMove}
        onMouseUp={onBoardMouseUp}
        onMouseLeave={onBoardMouseUp}
      >
        <div className="kanban-board">
          {columns.map(col => {
            const colTasks = getColTasks(col.status)
            const isColDragging = draggingColStatus === col.status
            const isColDragOver = dragOverColStatus === col.status
            const isTaskDragOver = dragOverStatus === col.status
            return (
              <div
                key={col.status}
                className={`kanban-column${isTaskDragOver ? ' kanban-column--drag-over' : ''}${isColDragOver ? ' kanban-column--col-drag-over' : ''}${isColDragging ? ' kanban-column--col-dragging' : ''}`}
                onDragOver={e => {
                  onDragOver(e, col.status)
                  onColDragOver(e, col.status)
                }}
                onDrop={e => {
                  onDrop(e, col.status)
                  onColDrop(e, col.status)
                }}
                onDragLeave={e => {
                  if (!e.currentTarget.contains(e.relatedTarget)) {
                    setDragOverStatus(null)
                    setDragOverColStatus(null)
                  }
                }}
              >
                <div
                  className="kanban-column-header"
                  draggable
                  onDragStart={e => onColDragStart(e, col.status)}
                  onDragEnd={onDragEnd}
                  title="Drag to reorder column"
                >
                  <div className="kanban-column-title">
                    <span className="kanban-col-drag-handle">⠿</span>
                    <span
                      className="kanban-column-dot"
                      style={{ background: col.color, cursor: 'pointer' }}
                      title="Change color"
                      onClick={e => {
                        e.stopPropagation()
                        setEditingColStatus(editingColStatus === col.status ? null : col.status)
                        setEditingColLabel(col.label)
                      }}
                    />
                    {editingColStatus === col.status ? (
                      <input
                        className="kanban-col-rename-input"
                        value={editingColLabel}
                        autoFocus
                        onChange={e => setEditingColLabel(e.target.value)}
                        onBlur={() => commitRenameCol(col.status)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') commitRenameCol(col.status)
                          if (e.key === 'Escape') { setEditingColStatus(null); setEditingColLabel('') }
                        }}
                        onClick={e => e.stopPropagation()}
                      />
                    ) : (
                      <span
                        className="kanban-col-label"
                        title="Click to rename"
                        onClick={e => { e.stopPropagation(); startRenameCol(col.status, col.label) }}
                      >{col.label}</span>
                    )}
                    <span className="kanban-column-count">
                      {visibleTasks.filter(t => t.status === col.status).length}
                      {hasKbFilters ? `/${tasks.filter(t => t.status === col.status).length}` : ''}
                    </span>
                  </div>
                  <div className="kanban-col-header-actions" onClick={e => e.stopPropagation()}>
                    <button
                      className="kanban-add-btn"
                      onMouseDown={e => e.stopPropagation()}
                      onClick={() => addingFor === col.status ? setAddingFor(null) : startAdding(col.status)}
                      title={`Add task to ${col.label}`}
                    >+</button>
                    <button
                      className="kanban-col-delete-btn"
                      onMouseDown={e => e.stopPropagation()}
                      onClick={() => deleteColumn(col.status)}
                      title="Delete column"
                    >✕</button>
                  </div>
                </div>

                {/* Color swatches shown when editing column */}
                {editingColStatus === col.status && (
                  <div className="kanban-col-color-picker" onClick={e => e.stopPropagation()}>
                    {COL_COLORS.map(c => (
                      <button
                        key={c}
                        className={`kanban-col-color-swatch${col.color === c ? ' active' : ''}`}
                        style={{ background: c }}
                        onMouseDown={e => e.stopPropagation()}
                        onClick={e => { e.stopPropagation(); changeColColor(col.status, c) }}
                        title={c}
                      />
                    ))}
                  </div>
                )}

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
                    {renderSubFormChildren(addForm.children || [], [])}
                    <button
                      className="kanban-add-subtask-btn"
                      onClick={() => setAddForm(f => ({ ...f, children: [...(f.children || []), { _lid: Date.now() + Math.random(), title: '', priority: 'medium', children: [] }] }))}
                    >+ Add subtask</button>
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
                              const statusCol = columns.find(c => c.status === sub.status)
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
                                      {columns.map(c => (
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
                    const statusCol = columns.find(c => c.status === sub.status)
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
                              {columns.map(c => (
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

          {/* Add column */}
          {addingCol ? (
            <div className="kanban-column kanban-add-col-panel">
              <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input
                  className="form-input"
                  placeholder="Column name *"
                  value={newColForm.label}
                  autoFocus
                  onChange={e => setNewColForm(p => ({ ...p, label: e.target.value }))}
                  onKeyDown={e => {
                    if (e.key === 'Enter') addColumn()
                    if (e.key === 'Escape') setAddingCol(false)
                  }}
                />
                <div className="kanban-col-color-picker">
                  {COL_COLORS.map(c => (
                    <button
                      key={c}
                      className={`kanban-col-color-swatch${newColForm.color === c ? ' active' : ''}`}
                      style={{ background: c }}
                      onClick={() => setNewColForm(p => ({ ...p, color: c }))}
                      title={c}
                    />
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn-ghost" style={{ flex: 1, fontSize: 12 }} onClick={() => setAddingCol(false)}>Cancel</button>
                  <button
                    className="btn-primary"
                    style={{ flex: 1, fontSize: 12 }}
                    onClick={addColumn}
                    disabled={!newColForm.label.trim()}
                  >Add column</button>
                </div>
              </div>
            </div>
          ) : (
            <button className="kanban-add-col-btn" onClick={() => setAddingCol(true)}>
              + Add column
            </button>
          )}
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
                  {columns.map(c => (
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
