import { useState, useEffect, useRef } from 'react'
import { apiFetch } from '../lib/api-fetch'
import AssigneeInput from './AssigneeInput'
import TaskContextMenu from './TaskContextMenu'
import TaskHistoryModal from './TaskHistoryModal'

const MAX_ATTACH_BYTES = 1024 * 1024 // 1MB cap per image (stored inline as data URL in Redis)

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

const STATUS_CYCLE = ['todo', 'in-progress', 'done']
const STATUS_LABEL = { 'backlog': 'Backlog', 'todo': 'To Do', 'in-progress': 'In Progress', 'in-review': 'In Review', 'review': 'Review', 'blocked': 'Blocked', 'done': 'Done' }
const STATUS_ORDER = ['backlog', 'todo', 'in-progress', 'in-review', 'review', 'blocked', 'done']
const STATUS_COLOR = { 'backlog': '#64748b', 'todo': '#2563eb', 'in-progress': '#f59e0b', 'in-review': '#9333ea', 'review': '#9333ea', 'blocked': '#dc2626', 'done': '#16a34a' }
// Statuses shown in the color legend (collapsed review variants).
const STATUS_LEGEND = ['backlog', 'todo', 'in-progress', 'in-review', 'blocked', 'done']
const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low']
const PRIORITY_COLOR = { low: '#64748b', medium: '#f59e0b', high: '#dc2626', critical: '#9f1239' }
const PRIORITY_LABEL = { low: 'Low', medium: 'Med', high: 'High', critical: 'Crit' }

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

function taskTimestamp(t) {
  const d = t.createdAt ? new Date(t.createdAt).getTime() : NaN
  if (!Number.isNaN(d)) return d
  return Number.isFinite(Number(t.seq)) ? Number(t.seq) : 0
}

const TASK_COMPARATORS = {
  order: (a, b) => a.order - b.order,
  newest: (a, b) => taskTimestamp(b) - taskTimestamp(a),
  oldest: (a, b) => taskTimestamp(a) - taskTimestamp(b),
}

function buildTree(tasks, sortBy = 'newest') {
  const byId = {}
  const roots = []
  tasks.forEach(t => { byId[t.id] = { ...t, children: [] } })
  tasks.forEach(t => {
    if (t.parentId && byId[t.parentId]) byId[t.parentId].children.push(byId[t.id])
    else roots.push(byId[t.id])
  })
  const cmp = TASK_COMPARATORS[sortBy] || TASK_COMPARATORS.newest
  function sort(nodes) {
    nodes.sort(cmp)
    nodes.forEach(n => sort(n.children))
  }
  sort(roots)
  return roots
}

function blankForm() {
  return { title: '', description: '', status: 'todo', priority: 'medium', assignees: [], startDate: '', dueDate: '', numberOverride: '', attachments: [], cover: null }
}

function TaskForm({ initial, onSave, onCancel, label, assignees = [] }) {
  const [form, setForm] = useState(initial || blankForm())
  const f = (k) => e => setForm(p => ({ ...p, [k]: e.target.value }))

  async function addImages(fileList) {
    const files = Array.from(fileList || [])
    const added = []
    for (const file of files) {
      if (!(file.type || '').startsWith('image/')) continue
      if (file.size > MAX_ATTACH_BYTES) { alert(`"${file.name}" is too large (max ${Math.round(MAX_ATTACH_BYTES / 1024)}KB).`); continue }
      const dataUrl = await readFileAsDataUrl(file)
      added.push({
        id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: file.name, type: file.type, size: file.size, dataUrl,
        uploadedAt: new Date().toISOString(),
      })
    }
    if (added.length) setForm(p => ({ ...p, attachments: [...(p.attachments || []), ...added] }))
  }
  function removeImage(id) {
    setForm(p => ({
      ...p,
      attachments: (p.attachments || []).filter(a => a.id !== id),
      cover: p.cover && p.cover.attId === id ? null : p.cover,
    }))
  }
  function toggleCover(att) {
    setForm(p => ({ ...p, cover: p.cover?.attId === att.id ? null : { dataUrl: att.dataUrl, attId: att.id } }))
  }

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
          <option value="review">Review</option>
          <option value="blocked">Blocked</option>
          <option value="done">Done</option>
        </select>
        <select className="form-input" value={form.priority} onChange={f('priority')}>
          <option value="low">Low priority</option>
          <option value="medium">Medium priority</option>
          <option value="high">High priority</option>
          <option value="critical">Critical priority</option>
        </select>
      </div>
      <AssigneeInput
        value={form.assignees}
        options={assignees}
        onChange={next => setForm(p => ({ ...p, assignees: next }))}
      />
      <div className="task-form-images">
        {(form.attachments || []).length > 0 && (
          <div className="task-form-thumbs">
            {(form.attachments || []).map(att => {
              const isCover = form.cover?.attId === att.id
              return (
                <div key={att.id} className={`task-form-thumb${isCover ? ' is-cover' : ''}`}>
                  <a href={att.dataUrl} target="_blank" rel="noopener noreferrer" title={att.name}>
                    <img src={att.dataUrl} alt={att.name} />
                  </a>
                  <button type="button" className="task-form-thumb-cover" onClick={() => toggleCover(att)} title={isCover ? 'Unset cover' : 'Set as cover'}>{isCover ? '★' : '☆'}</button>
                  <button type="button" className="task-form-thumb-remove" onClick={() => removeImage(att.id)} title="Remove">✕</button>
                </div>
              )
            })}
          </div>
        )}
        <label className="task-form-image-add">
          + Add image
          <input type="file" accept="image/*" multiple onChange={e => { addImages(e.target.files); e.target.value = '' }} style={{ display: 'none' }} />
        </label>
      </div>
      <div className="task-form-row">
        <label className="task-form-date">
          <span className="task-form-date-label">Start</span>
          <input className="form-input" type="date" title="Start date" value={form.startDate} onChange={f('startDate')} />
        </label>
        <label className="task-form-date">
          <span className="task-form-date-label">End</span>
          <input className="form-input" type="date" title="End date" value={form.dueDate} onChange={f('dueDate')} />
        </label>
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

function TaskNode({ node, apiBase, onRefresh, depth = 0, assignees = [], currentUser, dnd, taskAcl, taskPrefix, onContextMenu }) {
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

  const isAdmin = !!currentUser?.isAdmin
  const isMine = !!currentUser?.name && nodeAssignees.some(a => (typeof a === 'object' ? a?.name : a) === currentUser.name)
  // Full edit for admins; assignees may only change status of their own tasks.
  const canEdit = isAdmin
  const canChangeStatus = isAdmin || isMine
  // Project ACL: which statuses a non-admin assignee may set (admins unrestricted).
  const statusAllowed = status => {
    if (isAdmin) return true
    if (taskAcl?.assigneeCanChangeStatus === false) return false
    const list = taskAcl?.assigneeStatuses
    if (!Array.isArray(list)) return true
    return list.includes(status)
  }

  const hasChildren = node.children && node.children.length > 0

  async function setStatus(next) {
    if (!canChangeStatus || next === localStatus) return
    if (!statusAllowed(next)) { alert('You are not allowed to set this status.'); return }
    setLocalStatus(next)
    apiFetch(`${apiBase}/${node.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    })
  }

  async function cycleStatus() {
    if (!canChangeStatus) return
    // Advance to the next status in the cycle the user is actually allowed to set.
    const start = STATUS_CYCLE.indexOf(localStatus)
    for (let i = 1; i <= STATUS_CYCLE.length; i++) {
      const cand = STATUS_CYCLE[(start + i) % STATUS_CYCLE.length]
      if (cand === localStatus) break
      if (statusAllowed(cand)) { setStatus(cand); return }
    }
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
        attachments: form.attachments || [],
        cover: form.cover || null,
      }),
    })
    setEditing(false)
    onRefresh()
  }

  async function handleEditId() {
    const input = window.prompt(`Set task ID number for "${node.title}".\nCurrent: ${taskPrefix}-${node.seq}\nIDs are unique per project and won't change unless edited here.`, String(node.seq ?? ''))
    if (input == null) return
    const n = parseInt(input.trim(), 10)
    if (!Number.isInteger(n) || n < 1) { window.alert('Enter a positive whole number.'); return }
    if (n === node.seq) return
    const res = await apiFetch(`${apiBase}/${node.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seq: n }),
    })
    if (!res.ok) {
      let msg = 'Could not update task ID.'
      try { msg = (await res.json()).error || msg } catch {}
      window.alert(msg)
      return
    }
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

  const statusClass = localStatus === 'done' ? 'task-status done' : localStatus === 'in-progress' ? 'task-status in-progress' : localStatus === 'blocked' ? 'task-status blocked' : (localStatus === 'review' || localStatus === 'in-review') ? 'task-status review' : localStatus === 'backlog' ? 'task-status backlog' : 'task-status todo'

  const { total: descTotal, done: descDone } = hasChildren ? getDescendantStats(node) : { total: 0, done: 0 }

  const dropZone = dnd?.dropTarget?.id === node.id ? dnd.dropTarget.zone : null

  return (
    <div className="task-node" style={{ '--depth': depth }} data-depth={depth} data-group={hasChildren ? 'true' : undefined}>
      <div
        className={`task-row task-row--${localStatus}${localStatus === 'done' ? ' task-row-done' : ''}${dropZone ? ` task-row--drop-${dropZone}` : ''}`}
        onContextMenu={onContextMenu ? e => onContextMenu(e, node) : undefined}
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
          {node.seq != null && (
            <span
              className={`task-id-badge${canEdit ? ' task-id-badge--editable' : ''}`}
              title={canEdit ? 'Click to edit task ID' : 'Task ID'}
              onClick={canEdit ? handleEditId : undefined}
            >{taskPrefix ? `${taskPrefix}-${node.seq}` : `#${node.seq}`}</span>
          )}
          <span className="task-number" title={node.autoNumber !== node.number ? `Auto: ${node.autoNumber}` : 'Auto-numbered'}>
            {node.number}
          </span>
          <button className={statusClass} onClick={cycleStatus} disabled={!canChangeStatus} title={canChangeStatus ? `Status: ${STATUS_LABEL[localStatus]} — click to cycle` : `Status: ${STATUS_LABEL[localStatus]}`}>
            {localStatus === 'done' ? '✓' : localStatus === 'in-progress' ? '◑' : localStatus === 'blocked' ? '⊘' : (localStatus === 'review' || localStatus === 'in-review') ? '◎' : '○'}
          </button>
          <span
            className="task-title task-title--clickable"
            onClick={() => { setShowDetail(true); setDetailEditing(false) }}
            title="Click for details"
            style={{ textDecoration: localStatus === 'done' ? 'line-through' : 'none', opacity: localStatus === 'done' ? 0.55 : 1 }}
          >
            {node.title}
          </span>
          {node.cover?.dataUrl && (
            <img src={node.cover.dataUrl} alt="cover" className="task-row-cover" title="Cover image" />
          )}
          {Array.isArray(node.attachments) && node.attachments.length > 0 && (
            <span className="task-meta-chip task-attach-chip" title={`${node.attachments.length} image(s)`}>🖼 {node.attachments.length}</span>
          )}
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
          {canEdit && <>
            <button className="task-action-btn task-action-btn--move" onClick={() => handleMove('up')} title="Move up">↑</button>
            <button className="task-action-btn task-action-btn--move" onClick={() => handleMove('down')} title="Move down">↓</button>
            <button className="task-action-btn" onClick={() => { setAddingChild(v => !v); setEditing(false) }} title="Add sub-task">+ sub</button>
            <button className="task-action-btn" onClick={() => { setEditing(v => !v); setAddingChild(false); setShowUpdates(false) }} title="Edit task">Edit</button>
            <button className={`task-action-btn ${showUpdates ? 'active' : ''}`} onClick={() => { setShowUpdates(v => !v); setEditing(false); setAddingChild(false) }} title="Updates">Updates</button>
            <button className="task-action-btn danger" onClick={handleDelete} title="Delete task">✕</button>
          </>}
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
              attachments: Array.isArray(node.attachments) ? node.attachments : [],
              cover: node.cover || null,
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
              <span>{detailEditing ? 'Edit Task' : `Task ${node.seq != null ? (taskPrefix ? `${taskPrefix}-${node.seq}` : `#${node.seq}`) : node.number}`}</span>
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
                  attachments: Array.isArray(node.attachments) ? node.attachments : [],
                  cover: node.cover || null,
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
                  <div className="task-detail-field">
                    <span className="task-detail-label">Status</span>
                    {canChangeStatus ? (
                      <select className="form-input" value={localStatus} onChange={e => setStatus(e.target.value)} style={{ maxWidth: 180, fontSize: 12 }}>
                        {STATUS_ORDER.map(s => <option key={s} value={s} disabled={!statusAllowed(s)}>{STATUS_LABEL[s] || s}</option>)}
                      </select>
                    ) : (
                      <span className={statusClass + ' task-detail-static'}>{STATUS_LABEL[localStatus] || localStatus}</span>
                    )}
                  </div>
                  <div className="task-detail-field"><span className="task-detail-label">Priority</span><span>{PRIORITY_LABEL[node.priority] || node.priority || '—'}</span></div>
                  <div className="task-detail-field"><span className="task-detail-label">Start</span><span>{node.startDate || '—'}</span></div>
                  <div className="task-detail-field"><span className="task-detail-label">Due</span><span>{node.dueDate || '—'}</span></div>
                </div>
                <div className="task-detail-field">
                  <span className="task-detail-label">Assignees</span>
                  <span>{nodeAssignees.length ? nodeAssignees.map(a => typeof a === 'object' ? a.name : a).join(', ') : '—'}</span>
                </div>
                <div className="task-detail-field">
                  <span className="task-detail-label">Assigned by</span>
                  <span>{node.assignedBy || '—'}</span>
                </div>
                <div className="task-detail-field">
                  <span className="task-detail-label">Description</span>
                  <span className="task-detail-desc">{node.description || '—'}</span>
                </div>
                {Array.isArray(node.attachments) && node.attachments.length > 0 && (
                  <div className="task-detail-field">
                    <span className="task-detail-label">Images</span>
                    <div className="task-detail-thumbs">
                      {node.attachments.map(att => (
                        <a key={att.id} href={att.dataUrl} target="_blank" rel="noopener noreferrer" title={att.name}>
                          <img src={att.dataUrl} alt={att.name} className="task-detail-thumb" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
                {canEdit && (
                  <div className="task-detail-actions">
                    <button className="btn-primary" style={{ fontSize: 12 }} onClick={() => setDetailEditing(true)}>Edit</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {expanded && hasChildren && (
        <div className="task-children">
          {node.children.map(child => (
            <TaskNode key={child.id} node={child} apiBase={apiBase} onRefresh={onRefresh} depth={depth + 1} assignees={assignees} currentUser={currentUser} dnd={dnd} taskAcl={taskAcl} taskPrefix={taskPrefix} onContextMenu={onContextMenu} />
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

export default function TaskTree({ tasks, apiBase, onRefresh, currentUser, taskAcl, taskPrefix }) {
  const [addingRoot, setAddingRoot] = useState(false)
  const [ctxMenu, setCtxMenu] = useState(null)   // { x, y, task }
  const [historyTask, setHistoryTask] = useState(null)
  const isAdmin = !!currentUser?.isAdmin
  function handleContextMenu(e, task) {
    if (!isAdmin) return
    e.preventDefault()
    setCtxMenu({ x: e.clientX, y: e.clientY, task })
  }
  function taskLabel(t) {
    return taskPrefix && t.seq != null ? `${taskPrefix}-${t.seq}` : (t.number ? `#${t.number}` : '')
  }
  const [assignees, setAssignees] = useState([])
  const [sortBy, setSortBy] = useState('newest')
  const [search, setSearch] = useState('')
  const [filterPerson, setFilterPerson] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterPriority, setFilterPriority] = useState('')
  const [startFrom, setStartFrom] = useState('')
  const [startTo, setStartTo] = useState('')
  const [dueFrom, setDueFrom] = useState('')
  const [dueTo, setDueTo] = useState('')
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
  const tree = buildTree(liveTasks, sortBy)

  const q = search.toLowerCase()
  const pq = filterPerson.toLowerCase().trim()
  const isFiltering = q || pq || filterStatus || filterPriority || startFrom || startTo || dueFrom || dueTo
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
        const matchesStatus = !filterStatus || (t.status || 'todo') === filterStatus
        const matchesPriority = !filterPriority || (t.priority || 'medium') === filterPriority
        const sd = t.startDate || ''
        const matchesStart = (!startFrom || (sd && sd >= startFrom)) && (!startTo || (sd && sd <= startTo))
        const dd = t.dueDate || ''
        const matchesDue = (!dueFrom || (dd && dd >= dueFrom)) && (!dueTo || (dd && dd <= dueTo))
        return matchesSearch && matchesPerson && matchesStatus && matchesPriority && matchesStart && matchesDue
      }).sort(TASK_COMPARATORS[sortBy] || TASK_COMPARATORS.newest)
    : null

  const statusOptions = (() => {
    const present = new Set(liveTasks.map(t => t.status || 'todo'))
    return [...STATUS_ORDER.filter(s => present.has(s)), ...[...present].filter(s => !STATUS_ORDER.includes(s))]
  })()

  function clearFilters() {
    setSearch(''); setFilterPerson(''); setFilterStatus(''); setFilterPriority('')
    setStartFrom(''); setStartTo(''); setDueFrom(''); setDueTo('')
  }

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
          <select className="form-input filter-select" value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ fontSize: 12, padding: '5px 8px' }} title="Sort tasks">
            <option value="newest">Latest first</option>
            <option value="oldest">Oldest first</option>
            <option value="order">Manual order</option>
          </select>
        )}
        {liveTasks.length > 0 && (
          <select className="form-input filter-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ fontSize: 12, padding: '5px 8px' }}>
            <option value="">All statuses</option>
            {statusOptions.map(s => <option key={s} value={s}>{STATUS_LABEL[s] || s}</option>)}
          </select>
        )}
        {liveTasks.length > 0 && (
          <select className="form-input filter-select" value={filterPriority} onChange={e => setFilterPriority(e.target.value)} style={{ fontSize: 12, padding: '5px 8px' }}>
            <option value="">All priorities</option>
            {PRIORITY_ORDER.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
          </select>
        )}
        {liveTasks.length > 0 && (
          <div className="tt-date-filter" title="Filter by start date">
            <span className="tt-date-filter-label">Start</span>
            <input type="date" className="form-input tt-date-input" value={startFrom} onChange={e => setStartFrom(e.target.value)} title="Start date from" />
            <span className="tt-date-filter-sep">–</span>
            <input type="date" className="form-input tt-date-input" value={startTo} onChange={e => setStartTo(e.target.value)} title="Start date to" />
          </div>
        )}
        {liveTasks.length > 0 && (
          <div className="tt-date-filter" title="Filter by due date">
            <span className="tt-date-filter-label">Due</span>
            <input type="date" className="form-input tt-date-input" value={dueFrom} onChange={e => setDueFrom(e.target.value)} title="Due date from" />
            <span className="tt-date-filter-sep">–</span>
            <input type="date" className="form-input tt-date-input" value={dueTo} onChange={e => setDueTo(e.target.value)} title="Due date to" />
          </div>
        )}
        {isFiltering && (
          <button className="btn-ghost" onClick={clearFilters} style={{ fontSize: 12, padding: '5px 10px' }} title="Clear all filters">Clear</button>
        )}
        {liveTasks.length > 0 && (
          <span className="task-count-label">
            {filtered ? `${filtered.length} of ${liveTasks.length}` : `${liveTasks.length} task${liveTasks.length !== 1 ? 's' : ''}`}
          </span>
        )}
        <div className="status-legend" title="Status color key">
          {STATUS_LEGEND.map(s => (
            <span key={s} className="status-legend-item">
              <span className="status-legend-dot" style={{ background: STATUS_COLOR[s] }} />
              {STATUS_LABEL[s]}
            </span>
          ))}
        </div>
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
              <TaskNode key={t.id} node={{ ...t, children: [] }} apiBase={apiBase} onRefresh={onRefresh} depth={0} assignees={assignees} currentUser={currentUser} taskAcl={taskAcl} taskPrefix={taskPrefix} onContextMenu={handleContextMenu} />
            ))}
          </div>
        )
      ) : tree.length === 0 && !addingRoot ? (
        <div className="empty-state-sm" style={{ padding: '24px 16px' }}>No tasks yet. Click "+ Add Task" to get started.</div>
      ) : (
        <div className="task-list">
          {tree.map(node => (
            <TaskNode key={node.id} node={node} apiBase={apiBase} onRefresh={onRefresh} depth={0} assignees={assignees} currentUser={currentUser} dnd={sortBy === 'order' ? dnd : null} taskAcl={taskAcl} taskPrefix={taskPrefix} onContextMenu={handleContextMenu} />
          ))}
        </div>
      )}

      {ctxMenu && (
        <TaskContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          items={[{ label: 'View activity / history', icon: '🕑', onClick: () => setHistoryTask(ctxMenu.task) }]}
        />
      )}
      {historyTask && (
        <TaskHistoryModal
          apiBase={apiBase}
          task={historyTask}
          label={taskLabel(historyTask)}
          onClose={() => setHistoryTask(null)}
        />
      )}
    </div>
  )
}
