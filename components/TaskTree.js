import { useState, useEffect, useRef } from 'react'
import { apiFetch } from '../lib/api-fetch'
import AssigneeInput from './AssigneeInput'

const STATUS_CYCLE = ['todo', 'in-progress', 'done']
const STATUS_LABEL = { 'todo': 'To Do', 'in-progress': 'In Progress', 'done': 'Done' }
const PRIORITY_COLOR = { low: '#64748b', medium: '#f59e0b', high: '#dc2626' }
const PRIORITY_LABEL = { low: 'Low', medium: 'Med', high: 'High' }

function getInitials(name) {
  if (!name) return '?'
  return name.split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

const AVATAR_THEMES = [
  { bg: 'rgba(124,58,237,.13)',  color: '#7c3aed', border: 'rgba(124,58,237,.28)' },
  { bg: 'rgba(29,78,216,.13)',   color: '#1d4ed8', border: 'rgba(29,78,216,.28)' },
  { bg: 'rgba(5,150,105,.13)',   color: '#059669', border: 'rgba(5,150,105,.28)' },
  { bg: 'rgba(217,119,6,.13)',   color: '#d97706', border: 'rgba(217,119,6,.28)' },
  { bg: 'rgba(220,38,38,.13)',   color: '#dc2626', border: 'rgba(220,38,38,.28)' },
  { bg: 'rgba(8,145,178,.13)',   color: '#0891b2', border: 'rgba(8,145,178,.28)' },
  { bg: 'rgba(79,70,229,.13)',   color: '#4f46e5', border: 'rgba(79,70,229,.28)' },
  { bg: 'rgba(180,83,9,.13)',    color: '#b45309', border: 'rgba(180,83,9,.28)' },
]

function nameToAvatarTheme(name) {
  if (!name) return AVATAR_THEMES[0]
  let h = 0
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h)
  return AVATAR_THEMES[Math.abs(h) % AVATAR_THEMES.length]
}

function getDescendantStats(node) {
  let total = 0, done = 0
  function walk(n) {
    n.children?.forEach(c => { total++; if (c.status === 'done') done++; walk(c) })
  }
  walk(node)
  return { total, done }
}

function buildTree(tasks) {
  const byId = {}
  const roots = []
  tasks.forEach(t => { byId[t.id] = { ...t, children: [] } })
  tasks.forEach(t => {
    if (t.parentId && byId[t.parentId]) byId[t.parentId].children.push(byId[t.id])
    else roots.push(byId[t.id])
  })
  function sort(nodes) {
    nodes.sort((a, b) => a.order - b.order)
    nodes.forEach(n => sort(n.children))
  }
  sort(roots)
  return roots
}

function blankForm() {
  return { title: '', description: '', status: 'todo', priority: 'medium', assignees: [], startDate: '', dueDate: '', numberOverride: '' }
}

function TaskForm({ initial, onSave, onCancel, label, assignees = [] }) {
  const [form, setForm] = useState(initial || blankForm())
  const f = (k) => e => setForm(p => ({ ...p, [k]: e.target.value }))

  return (
    <div className="task-form">
      <div className="task-form-row">
        <input className="form-input" placeholder="Task title *" value={form.title} onChange={f('title')} autoFocus required />
        <input className="form-input task-num-input" placeholder="# override (e.g. 1.2.3)" value={form.numberOverride} onChange={f('numberOverride')} title="Custom number (leave blank for auto)" />
      </div>
      <textarea className="form-input task-desc-input" placeholder="Description (optional)" value={form.description} onChange={f('description')} rows={2} />
      <div className="task-form-row">
        <select className="form-input" value={form.status} onChange={f('status')}>
          <option value="todo">To Do</option>
          <option value="in-progress">In Progress</option>
          <option value="done">Done</option>
        </select>
        <select className="form-input" value={form.priority} onChange={f('priority')}>
          <option value="low">Low priority</option>
          <option value="medium">Medium priority</option>
          <option value="high">High priority</option>
        </select>
      </div>
      <AssigneeInput
        value={form.assignees}
        options={assignees}
        onChange={next => setForm(p => ({ ...p, assignees: next }))}
      />
      <div className="task-form-row">
        <input className="form-input" type="date" title="Start date" value={form.startDate} onChange={f('startDate')} />
        <input className="form-input" type="date" title="Due date" value={form.dueDate} onChange={f('dueDate')} />
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          <button className="btn-ghost" type="button" onClick={onCancel} style={{ fontSize: 12 }}>Cancel</button>
          <button className="btn-primary" type="button" onClick={() => form.title.trim() && onSave(form)} style={{ fontSize: 12 }} disabled={!form.title.trim()}>
            {label || 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function TaskNode({ node, apiBase, onRefresh, depth = 0, assignees = [], currentUser, dnd }) {
  const [expanded, setExpanded] = useState(true)
  const [editing, setEditing] = useState(false)
  const [addingChild, setAddingChild] = useState(false)
  const [showUpdates, setShowUpdates] = useState(false)
  const [updateText, setUpdateText] = useState('')
  const [updateAuthor, setUpdateAuthor] = useState('')
  const [savingUpdate, setSavingUpdate] = useState(false)
  const [localStatus, setLocalStatus] = useState(node.status)
  const [showDetail, setShowDetail] = useState(false)
  const [detailEditing, setDetailEditing] = useState(false)

  useEffect(() => { setLocalStatus(node.status) }, [node.status])

  const nodeAssignees = Array.isArray(node.assignees) ? node.assignees : (node.assignee ? [node.assignee] : [])

  const hasChildren = node.children && node.children.length > 0

  async function cycleStatus() {
    const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(localStatus) + 1) % STATUS_CYCLE.length]
    setLocalStatus(next)
    apiFetch(`${apiBase}/${node.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    })
  }

  async function handleSaveEdit(form) {
    await apiFetch(`${apiBase}/${node.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: form.title,
        description: form.description,
        status: form.status,
        priority: form.priority,
        assignees: form.assignees || [],
        startDate: form.startDate || null,
        dueDate: form.dueDate || null,
        numberOverride: form.numberOverride || null,
      }),
    })
    setEditing(false)
    onRefresh()
  }

  async function handleAddUpdate() {
    if (!updateText.trim()) return
    setSavingUpdate(true)
    const existing = Array.isArray(node.updates) ? node.updates : []
    const newUpdate = {
      id: `upd-${Date.now()}`,
      text: updateText.trim(),
      author: updateAuthor.trim() || null,
      createdAt: new Date().toISOString(),
    }
    await apiFetch(`${apiBase}/${node.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates: [...existing, newUpdate] }),
    })
    setUpdateText('')
    setSavingUpdate(false)
    onRefresh()
  }

  async function handleDelete() {
    const childCount = countDescendants(node)
    const msg = childCount > 0
      ? `Delete "${node.title}" and its ${childCount} sub-task(s)?`
      : `Delete "${node.title}"?`
    if (!confirm(msg)) return
    await apiFetch(`${apiBase}/${node.id}`, { method: 'DELETE' })
    onRefresh()
  }

  async function handleAddChild(form) {
    await apiFetch(apiBase, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, parentId: node.id, numberOverride: form.numberOverride || null }),
    })
    setAddingChild(false)
    setExpanded(true)
    onRefresh()
  }

  async function handleMove(direction) {
    await apiFetch(`${apiBase}/${node.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction }),
    })
    onRefresh()
  }

  const statusClass = localStatus === 'done' ? 'task-status done' : localStatus === 'in-progress' ? 'task-status in-progress' : 'task-status todo'

  const { total: descTotal, done: descDone } = hasChildren ? getDescendantStats(node) : { total: 0, done: 0 }

  const dropZone = dnd?.dropTarget?.id === node.id ? dnd.dropTarget.zone : null

  return (
    <div className="task-node" style={{ '--depth': depth }} data-depth={depth} data-group={hasChildren ? 'true' : undefined}>
      <div
        className={`task-row task-row--${localStatus}${localStatus === 'done' ? ' task-row-done' : ''}${dropZone ? ` task-row--drop-${dropZone}` : ''}`}
        draggable={!!dnd}
        onDragStart={dnd ? e => { e.dataTransfer.effectAllowed = 'move'; dnd.onDragStart(node.id) } : undefined}
        onDragOver={dnd ? e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; const r = e.currentTarget.getBoundingClientRect(); const rel = (e.clientY - r.top) / r.height; dnd.onDragOver(node.id, rel < 0.28 ? 'before' : rel > 0.72 ? 'after' : 'child') } : undefined}
        onDrop={dnd ? e => { e.preventDefault(); dnd.onDrop(node.id) } : undefined}
        onDragEnd={dnd ? dnd.onDragEnd : undefined}
      >
        <div className="task-row-left">
          {dnd && <span className="task-drag-handle" title="Drag to reorder or nest">⠿</span>}
          <button
            className="task-expand-btn"
            onClick={() => setExpanded(v => !v)}
            style={{ visibility: hasChildren ? 'visible' : 'hidden' }}
            title={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? '▼' : '▶'}
          </button>
          <span className="task-number" title={node.autoNumber !== node.number ? `Auto: ${node.autoNumber}` : 'Auto-numbered'}>
            {node.number}
          </span>
          <button className={statusClass} onClick={cycleStatus} title={`Status: ${STATUS_LABEL[localStatus]} — click to cycle`}>
            {localStatus === 'done' ? '✓' : localStatus === 'in-progress' ? '◑' : '○'}
          </button>
          <span
            className="task-title task-title--clickable"
            onClick={() => { setShowDetail(true); setDetailEditing(false) }}
            title="Click for details"
            style={{ textDecoration: localStatus === 'done' ? 'line-through' : 'none', opacity: localStatus === 'done' ? 0.55 : 1 }}
          >
            {node.title}
          </span>
          {node.startDate && <span className="task-meta-chip task-start" title="Start date">▶ {node.startDate}</span>}
          {node.dueDate && <span className="task-meta-chip task-due" title="Due date">⏎ {node.dueDate}</span>}
          {node.description && <span className="task-meta-chip task-desc" title={node.description}>{node.description.length > 40 ? node.description.slice(0, 40) + '…' : node.description}</span>}
          {node.priority && node.priority !== 'medium' && (
            <span className="task-priority-dot" style={{ background: PRIORITY_COLOR[node.priority] }} title={`${PRIORITY_LABEL[node.priority]} priority`} />
          )}
          {hasChildren && descTotal > 0 && (
            <span className={`task-progress-chip${descDone === descTotal ? ' task-progress-chip--complete' : ''}`}>
              {descDone}/{descTotal}
            </span>
          )}
          {nodeAssignees.map((a, i) => {
            const label = typeof a === 'object' ? a.name : a
            const theme = nameToAvatarTheme(label)
            return (
              <span key={label ?? i} className="task-assignee-avatar" title={label}
                style={{ background: theme.bg, color: theme.color, borderColor: theme.border }}>
                {getInitials(label)}
              </span>
            )
          })}
          {node.updates && node.updates.length > 0 && (
            <span className="task-meta-chip task-updates-badge" title={`${node.updates.length} update(s)`}>
              {node.updates.length} update{node.updates.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="task-row-actions">
          <button className="task-action-btn task-action-btn--move" onClick={() => handleMove('up')} title="Move up">↑</button>
          <button className="task-action-btn task-action-btn--move" onClick={() => handleMove('down')} title="Move down">↓</button>
          <button className="task-action-btn" onClick={() => { setAddingChild(v => !v); setEditing(false) }} title="Add sub-task">+ sub</button>
          <button className="task-action-btn" onClick={() => { setEditing(v => !v); setAddingChild(false); setShowUpdates(false) }} title="Edit task">Edit</button>
          <button className={`task-action-btn ${showUpdates ? 'active' : ''}`} onClick={() => { setShowUpdates(v => !v); setEditing(false); setAddingChild(false) }} title="Updates">Updates</button>
          {currentUser?.isAdmin && (
            <button className="task-action-btn danger" onClick={handleDelete} title="Delete task">✕</button>
          )}
        </div>
      </div>

      {editing && (
        <div className="task-inline-form">
          <TaskForm
            initial={{
              title: node.title,
              description: node.description || '',
              status: localStatus,
              priority: node.priority || 'medium',
              assignees: nodeAssignees,
              startDate: node.startDate || '',
              dueDate: node.dueDate || '',
              numberOverride: node.numberOverride || '',
            }}
            onSave={handleSaveEdit}
            onCancel={() => setEditing(false)}
            label="Update"
            assignees={assignees}
          />
        </div>
      )}

      {showUpdates && (
        <div className="task-updates-panel">
          <div className="task-updates-list">
            {(!node.updates || node.updates.length === 0) ? (
              <div className="task-updates-empty">No updates yet.</div>
            ) : (
              [...node.updates].reverse().map(u => (
                <div key={u.id} className="task-update-item">
                  <div className="task-update-meta">
                    {u.author && <span className="task-update-author">{u.author}</span>}
                    <span className="task-update-time">{new Date(u.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="task-update-text">{u.text}</div>
                </div>
              ))
            )}
          </div>
          <div className="task-update-form">
            <input
              className="form-input"
              placeholder="Your name (optional)"
              value={updateAuthor}
              onChange={e => setUpdateAuthor(e.target.value)}
              style={{ maxWidth: 160, fontSize: 12 }}
            />
            <input
              className="form-input"
              placeholder="Add an update…"
              value={updateText}
              onChange={e => setUpdateText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleAddUpdate()}
              style={{ flex: 1, fontSize: 12 }}
            />
            <button
              className="btn-primary"
              onClick={handleAddUpdate}
              disabled={!updateText.trim() || savingUpdate}
              style={{ fontSize: 12, padding: '5px 12px', whiteSpace: 'nowrap' }}
            >
              Post
            </button>
          </div>
        </div>
      )}

      {addingChild && (
        <div className="task-inline-form">
          <TaskForm onSave={handleAddChild} onCancel={() => setAddingChild(false)} label="Add Sub-task" assignees={assignees} />
        </div>
      )}

      {showDetail && (
        <div className="kanban-modal-overlay" onClick={e => { if (e.target === e.currentTarget) { setShowDetail(false); setDetailEditing(false) } }}>
          <div className="kanban-modal">
            <div className="kanban-modal-header">
              <span>{detailEditing ? 'Edit Task' : `Task ${node.number}`}</span>
              <button className="kanban-modal-close" onClick={() => { setShowDetail(false); setDetailEditing(false) }}>✕</button>
            </div>
            {detailEditing ? (
              <TaskForm
                initial={{
                  title: node.title,
                  description: node.description || '',
                  status: localStatus,
                  priority: node.priority || 'medium',
                  assignees: nodeAssignees,
                  startDate: node.startDate || '',
                  dueDate: node.dueDate || '',
                  numberOverride: node.numberOverride || '',
                }}
                onSave={async form => { await handleSaveEdit(form); setDetailEditing(false) }}
                onCancel={() => setDetailEditing(false)}
                label="Update"
                assignees={assignees}
              />
            ) : (
              <div className="task-detail">
                <div className="task-detail-title">{node.title}</div>
                <div className="task-detail-grid">
                  <div className="task-detail-field"><span className="task-detail-label">Status</span><span className={statusClass + ' task-detail-static'}>{STATUS_LABEL[localStatus] || localStatus}</span></div>
                  <div className="task-detail-field"><span className="task-detail-label">Priority</span><span>{PRIORITY_LABEL[node.priority] || node.priority || '—'}</span></div>
                  <div className="task-detail-field"><span className="task-detail-label">Start</span><span>{node.startDate || '—'}</span></div>
                  <div className="task-detail-field"><span className="task-detail-label">Due</span><span>{node.dueDate || '—'}</span></div>
                </div>
                <div className="task-detail-field">
                  <span className="task-detail-label">Assignees</span>
                  <span>{nodeAssignees.length ? nodeAssignees.map(a => typeof a === 'object' ? a.name : a).join(', ') : '—'}</span>
                </div>
                <div className="task-detail-field">
                  <span className="task-detail-label">Description</span>
                  <span className="task-detail-desc">{node.description || '—'}</span>
                </div>
                <div className="task-detail-actions">
                  <button className="btn-primary" style={{ fontSize: 12 }} onClick={() => setDetailEditing(true)}>Edit</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {expanded && hasChildren && (
        <div className="task-children">
          {node.children.map(child => (
            <TaskNode key={child.id} node={child} apiBase={apiBase} onRefresh={onRefresh} depth={depth + 1} assignees={assignees} currentUser={currentUser} dnd={dnd} />
          ))}
        </div>
      )}
    </div>
  )
}

function countDescendants(node) {
  let count = 0
  function walk(n) { n.children?.forEach(c => { count++; walk(c) }) }
  walk(node)
  return count
}

export default function TaskTree({ tasks, apiBase, onRefresh, currentUser }) {
  const [addingRoot, setAddingRoot] = useState(false)
  const [assignees, setAssignees] = useState([])
  const [search, setSearch] = useState('')
  const [filterPerson, setFilterPerson] = useState('')
  const draggedId = useRef(null)
  const [dropTarget, setDropTarget] = useState(null)

  const dnd = {
    dropTarget,
    onDragStart(nodeId) { draggedId.current = nodeId },
    onDragOver(nodeId, zone) {
      if (draggedId.current === nodeId) return
      setDropTarget(prev => prev?.id === nodeId && prev?.zone === zone ? prev : { id: nodeId, zone })
    },
    onDrop(nodeId) {
      const sourceId = draggedId.current
      const zone = dropTarget?.zone
      draggedId.current = null
      setDropTarget(null)
      if (!sourceId || sourceId === nodeId || !zone) return
      apiFetch(`${apiBase}/${sourceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'move', targetId: nodeId, position: zone }),
      }).then(() => onRefresh())
    },
    onDragEnd() { draggedId.current = null; setDropTarget(null) },
  }

  useEffect(() => {
    fetch('/api/assignees').then(r => r.ok ? r.json() : []).then(setAssignees).catch(() => {})
  }, [])

  const liveTasks = (tasks || []).filter(t => !t.archived)
  const tree = buildTree(liveTasks)

  const q = search.toLowerCase()
  const pq = filterPerson.toLowerCase().trim()
  const isFiltering = q || pq
  const filtered = isFiltering
    ? liveTasks.filter(t => {
        const taskAssignees = Array.isArray(t.assignees) ? t.assignees : (t.assignee ? [t.assignee] : [])
        const matchesSearch = !q || (
          t.title.toLowerCase().includes(q) ||
          (t.description || '').toLowerCase().includes(q) ||
          taskAssignees.some(a => a.toLowerCase().includes(q)) ||
          (t.number || '').toString().includes(q) ||
          (t.autoNumber || '').toString().includes(q) ||
          (t.numberOverride || '').toString().includes(q)
        )
        const matchesPerson = !pq || taskAssignees.some(a => a.toLowerCase().includes(pq))
        return matchesSearch && matchesPerson
      })
    : null

  async function handleAddRoot(form) {
    await apiFetch(apiBase, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, parentId: null, numberOverride: form.numberOverride || null }),
    })
    setAddingRoot(false)
    onRefresh()
  }

  return (
    <div className="task-tree">
      <div className="task-tree-toolbar">
        <button className="btn-primary" style={{ fontSize: 12, padding: '5px 12px' }} onClick={() => setAddingRoot(v => !v)}>
          {addingRoot ? 'Cancel' : '+ Add Task'}
        </button>
        {liveTasks.length > 0 && (
          <div className="search-bar" style={{ marginBottom: 0, flex: 1, maxWidth: 320 }}>
            <input
              className="form-input search-input"
              placeholder="Search tasks…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ fontSize: 12, padding: '5px 28px 5px 10px' }}
            />
            {search && (
              <button className="btn-ghost search-clear" onClick={() => setSearch('')} title="Clear">&#x2715;</button>
            )}
          </div>
        )}
        {liveTasks.length > 0 && assignees.length > 0 && (
          <div className="search-bar" style={{ marginBottom: 0, minWidth: 150, maxWidth: 200 }}>
            <input
              className="form-input search-input"
              list="tt-assignee-list"
              placeholder="Filter by person…"
              value={filterPerson}
              onChange={e => setFilterPerson(e.target.value)}
              style={{ fontSize: 12, padding: '5px 28px 5px 10px' }}
            />
            {filterPerson && (
              <button className="btn-ghost search-clear" onClick={() => setFilterPerson('')} title="Clear">&#x2715;</button>
            )}
            <datalist id="tt-assignee-list">
              {assignees.map(a => <option key={a.name} value={a.name} />)}
            </datalist>
          </div>
        )}
        {liveTasks.length > 0 && (
          <span className="task-count-label">
            {filtered ? `${filtered.length} of ${liveTasks.length}` : `${liveTasks.length} task${liveTasks.length !== 1 ? 's' : ''}`}
          </span>
        )}
      </div>

      {addingRoot && (
        <div className="task-inline-form" style={{ marginTop: 8 }}>
          <TaskForm onSave={handleAddRoot} onCancel={() => setAddingRoot(false)} label="Add Task" assignees={assignees} />
        </div>
      )}

      {filtered ? (
        filtered.length === 0 ? (
          <div className="empty-state-sm" style={{ padding: '24px 16px' }}>No tasks match the current filters.</div>
        ) : (
          <div className="task-list">
            {filtered.map(t => (
              <TaskNode key={t.id} node={{ ...t, children: [] }} apiBase={apiBase} onRefresh={onRefresh} depth={0} assignees={assignees} currentUser={currentUser} />
            ))}
          </div>
        )
      ) : tree.length === 0 && !addingRoot ? (
        <div className="empty-state-sm" style={{ padding: '24px 16px' }}>No tasks yet. Click "+ Add Task" to get started.</div>
      ) : (
        <div className="task-list">
          {tree.map(node => (
            <TaskNode key={node.id} node={node} apiBase={apiBase} onRefresh={onRefresh} depth={0} assignees={assignees} currentUser={currentUser} dnd={dnd} />
          ))}
        </div>
      )}
    </div>
  )
}
