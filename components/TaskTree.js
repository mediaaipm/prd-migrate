import { useState, useEffect, useRef } from 'react'
import { apiFetch } from '../lib/api-fetch'
import { enqueue } from '../lib/submit-queue'
import { taskDraft, taskCreateBody } from '../lib/task-draft'
import { hasPerm, isSuperAdmin } from '../lib/client-permissions'
import AssigneeInput from './AssigneeInput'
import AutoTextarea from './AutoTextarea'
import SubmitButton from './SubmitButton'
import TaskContextMenu from './TaskContextMenu'
import TaskHistoryModal from './TaskHistoryModal'
import FilterMultiSelect from './FilterMultiSelect'
import { useColumns, columnsWithTaskStatuses, labelForStatus } from '../lib/kanban-columns'
import { taskShareLink, copyText } from '../lib/task-link'
import { attSrc, coverSrc } from '../lib/attachment-src'

const MAX_ATTACH_BYTES = 1024 * 1024 // 1MB cap per image (stored inline as data URL in Redis)

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// Statuses come from the kanban columns, so a column added on the board shows up here
// too. Built-in ones keep their globals.css pill class; custom ones are coloured inline.
const STATUS_CLASS = {
  'backlog': 'backlog', 'todo': 'todo', 'in-progress': 'in-progress',
  'in-review': 'review', 'review': 'review', 'blocked': 'blocked', 'done': 'done',
}

function statusPillProps(status, color) {
  const cls = STATUS_CLASS[status]
  if (cls) return { className: `task-status ${cls}` }
  const c = color || '#64748b'
  return { className: 'task-status', style: { background: c, borderColor: c } }
}

const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low']
const PRIORITY_COLOR = { low: '#64748b', medium: '#f59e0b', high: '#dc2626', critical: '#9f1239' }
const PRIORITY_LABEL = { low: 'Low', medium: 'Med', high: 'High', critical: 'Crit' }

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Format an ISO date string (YYYY-MM-DD) as "Jan 3, 2026". Falls back to raw value if unparseable.
function formatDate(v) {
  if (!v) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
  if (!m) return v
  const [, y, mo, d] = m
  return `${MONTH_ABBR[+mo - 1]} ${+d}, ${y}`
}

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

function buildTree(tasks, sortBy = 'order') {
  const byId = {}
  const roots = []
  tasks.forEach(t => { byId[t.id] = { ...t, children: [] } })
  tasks.forEach(t => {
    if (t.parentId && byId[t.parentId]) byId[t.parentId].children.push(byId[t.id])
    else roots.push(byId[t.id])
  })
  const cmp = TASK_COMPARATORS[sortBy] || TASK_COMPARATORS.order
  function sort(nodes) {
    nodes.sort(cmp)
    nodes.forEach(n => sort(n.children))
  }
  sort(roots)
  return roots
}

// Build a pruned tree of the matched tasks plus every ancestor needed to reach
// them, so a matched child is always shown under its parent, plus every
// ancestor of a matched task so a matched child renders under its parent path.
// A matched parent does NOT drag in unmatched children — a person search surfaces
// only the tasks that person is actually on.
// Tasks that did not themselves match are flagged `__context` for dimmed display.
function buildFilteredTree(allTasks, matched, sortBy = 'order') {
  const byId = {}
  allTasks.forEach(t => { byId[t.id] = t })
  const matchedIds = new Set(matched.map(t => t.id))
  const includeIds = new Set(matchedIds)
  matched.forEach(t => {
    let pid = t.parentId
    while (pid && byId[pid] && !includeIds.has(pid)) {
      includeIds.add(pid)
      pid = byId[pid].parentId
    }
  })
  const included = allTasks
    .filter(t => includeIds.has(t.id))
    .map(t => ({ ...t, __context: !matchedIds.has(t.id) }))
  return buildTree(included, sortBy)
}

function blankForm() {
  return { title: '', description: '', status: 'todo', priority: 'medium', assignees: [], assignedBy: '', startDate: '', dueDate: '', numberOverride: '', attachments: [], cover: null }
}

// `quickAdd` collapses everything but the title behind a "More options" toggle — the
// common case is a title and Enter. `allowAddAnother` keeps the form open and cleared
// after a save so several sub-tasks can be typed in a row.
function TaskForm({ initial, onSave, onCancel, label, assignees = [], showCreator = false, currentUser = null, quickAdd = false, allowAddAnother = false, columns = [] }) {
  function makeInitial() {
    const base = initial || blankForm()
    // Auto-attribute the creator from the logged-in user; no manual entry.
    if (showCreator && !base.assignedBy && currentUser?.name) return { ...base, assignedBy: currentUser.name }
    return base
  }
  const [form, setForm] = useState(makeInitial)
  const [expanded, setExpanded] = useState(!quickAdd)
  const [addAnother, setAddAnother] = useState(false)
  const titleRef = useRef(null)
  const f = (k) => e => setForm(p => ({ ...p, [k]: e.target.value }))
  // Text typed in the assignee box but not yet turned into a token. Held in a ref
  // (not state) so it's always current at save time without a blur→re-render race.
  const pendingAssignee = useRef('')

  // onSave only enqueues now, so there is no response to await. SubmitButton owns the
  // busy state and the double-click guard.
  function submit() {
    if (!form.title.trim()) return
    const pending = pendingAssignee.current.trim()
    const cur = Array.isArray(form.assignees) ? form.assignees : []
    const assigneesFinal = pending && !cur.includes(pending) ? [...cur, pending] : cur
    const keepOpen = allowAddAnother && addAnother
    onSave({ ...form, assignees: assigneesFinal }, { keepOpen })
    if (!keepOpen) return
    // Keep the inherited defaults (status, priority, assignees, dates); clear what is
    // unique to the task just added.
    setForm(p => ({ ...p, title: '', description: '', numberOverride: '', attachments: [], cover: null }))
    pendingAssignee.current = ''
    requestAnimationFrame(() => titleRef.current?.focus())
  }

  function onFormKeyDown(e) {
    if (e.key === 'Escape') { e.stopPropagation(); onCancel?.() }
  }
  function onTitleKeyDown(e) {
    if (e.key === 'Enter' && !e.nativeEvent?.isComposing) { e.preventDefault(); submit() }
  }

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
    // Reference only — see setCover in KanbanBoard.
    setForm(p => ({ ...p, cover: p.cover?.attId === att.id ? null : { attId: att.id } }))
  }

  const advanced = (
    <>
      {quickAdd && (
        <input className="form-input task-num-input" placeholder="# override (e.g. 1.2.3)" value={form.numberOverride} onChange={f('numberOverride')} title="Custom number (leave blank for auto)" />
      )}
      <AutoTextarea className="form-input task-desc-input" placeholder="Description (optional)" value={form.description} onChange={f('description')} />
      <div className="task-form-row">
        <select className="form-input" value={form.status} onChange={f('status')}>
          {columns.map(c => <option key={c.status} value={c.status}>{c.label}</option>)}
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
        onQueryChange={v => { pendingAssignee.current = v }}
      />
      {showCreator && (
        form.assignedBy
          ? <div className="task-form-hint">Assigned by <strong>{form.assignedBy}</strong></div>
          : <input className="form-input" placeholder="Your name (added by)" value={form.assignedBy || ''} onChange={f('assignedBy')} />
      )}
      <div className="task-form-images">
        {(form.attachments || []).length > 0 && (
          <div className="task-form-thumbs">
            {(form.attachments || []).map(att => {
              const isCover = form.cover?.attId === att.id
              return (
                <div key={att.id} className={`task-form-thumb${isCover ? ' is-cover' : ''}`}>
                  <a href={attSrc(att)} target="_blank" rel="noopener noreferrer" title={att.name}>
                    <img src={attSrc(att)} alt={att.name} />
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
        {!quickAdd && (
          <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
            <button className="btn-ghost" type="button" onClick={onCancel} style={{ fontSize: 12 }}>Cancel</button>
            <SubmitButton className="btn-primary" onClick={submit} style={{ fontSize: 12 }} disabled={!form.title.trim()}>
              {label || 'Save'}
            </SubmitButton>
          </div>
        )}
      </div>
    </>
  )

  if (!quickAdd) {
    return (
      <div className="task-form" onKeyDown={onFormKeyDown}>
        <div className="task-form-row">
          <input ref={titleRef} className="form-input" placeholder="Task title *" value={form.title} onChange={f('title')} onKeyDown={onTitleKeyDown} autoFocus required />
          <input className="form-input task-num-input" placeholder="# override (e.g. 1.2.3)" value={form.numberOverride} onChange={f('numberOverride')} title="Custom number (leave blank for auto)" />
        </div>
        {advanced}
      </div>
    )
  }

  return (
    <div className="task-form task-form--quick" onKeyDown={onFormKeyDown}>
      <div className="task-quick-row">
        <span className="task-quick-arrow" aria-hidden="true">↳</span>
        <input
          ref={titleRef}
          className="form-input task-quick-input"
          placeholder="Sub-task title…"
          value={form.title}
          onChange={f('title')}
          onKeyDown={onTitleKeyDown}
          autoFocus
          required
        />
        <SubmitButton className="btn-primary task-quick-submit" onClick={submit} disabled={!form.title.trim()}>
          {label || 'Add'}
        </SubmitButton>
        <button className="btn-ghost task-quick-close" type="button" onClick={onCancel} title="Cancel (Esc)">✕</button>
      </div>
      {expanded && <div className="task-quick-advanced">{advanced}</div>}
      <div className="task-quick-footer">
        <button className="task-quick-toggle" type="button" onClick={() => setExpanded(v => !v)} aria-expanded={expanded}>
          {expanded ? '⌃ Fewer options' : '⌄ More options'}
        </button>
        {allowAddAnother && (
          <label className="task-quick-another" title="Keep this form open after adding">
            <input type="checkbox" checked={addAnother} onChange={e => setAddAnother(e.target.checked)} />
            Add another
          </label>
        )}
        <span className="task-quick-hint">Enter to add · Esc to close</span>
      </div>
    </div>
  )
}

function TaskNode({ node, apiBase, onRefresh, depth = 0, assignees = [], currentUser, dnd, taskAcl, taskPrefix, onContextMenu, columns = [], focusId, expandSignal }) {
  const [expanded, setExpanded] = useState(true)
  const [copied, setCopied] = useState(false)
  const rowRef = useRef(null)
  const isFocused = focusId === node.id
  const [editing, setEditing] = useState(false)
  const [addingChild, setAddingChild] = useState(false)
  const [showUpdates, setShowUpdates] = useState(false)
  const [updateText, setUpdateText] = useState('')
  const [updateAuthor, setUpdateAuthor] = useState('')
  const [localStatus, setLocalStatus] = useState(node.status)
  const [showDetail, setShowDetail] = useState(false)
  const [detailEditing, setDetailEditing] = useState(false)

  useEffect(() => { setLocalStatus(node.status) }, [node.status])

  // Collapse/expand all broadcasts a bumped counter; `n` (not `value`) is the dep so
  // hitting the same button twice still re-applies to rows toggled since.
  useEffect(() => {
    if (!expandSignal) return
    setExpanded(expandSignal.value)
  }, [expandSignal?.n])

  // Ancestors render expanded by default, so by the time the target row mounts it is
  // already on screen and can be scrolled to.
  useEffect(() => {
    if (!isFocused || !rowRef.current) return
    rowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [isFocused])

  async function copyLink() {
    if (!(await copyText(taskShareLink(node.id)))) return
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const nodeAssignees = Array.isArray(node.assignees) ? node.assignees : (node.assignee ? [node.assignee] : [])

  const isMine = !!currentUser?.name && nodeAssignees.some(a => (typeof a === 'object' ? a?.name : a) === currentUser.name)
  // Capability gates, keyed to real permissions (superadmin + subadmins).
  const canEdit = hasPerm(currentUser, 'task:update')   // full edit / assign / reorder
  const canCreate = hasPerm(currentUser, 'task:create') // add sub-task
  const canDelete = isSuperAdmin(currentUser) // superadmin only, by policy
  // Regular users (assignees) may still change the status of their own tasks.
  const canChangeStatus = canEdit || isMine
  // Global superadmin blocklist: statuses a regular user may never set (any project).
  // Admins/superadmin are exempt. Mirrors the server check in the task update route.
  const isPriv = !!currentUser?.isAdmin
  const restrictedStatuses = new Set(currentUser?.restrictedStatuses || [])
  // Project ACL: which statuses a non-admin assignee may set (task:update unrestricted).
  const statusAllowed = status => {
    if (!isPriv && restrictedStatuses.has(status)) return false
    if (canEdit) return true
    if (taskAcl?.assigneeCanChangeStatus === false) return false
    const list = taskAcl?.assigneeStatuses
    if (!Array.isArray(list)) return true
    return list.includes(status)
  }

  const hasChildren = node.children && node.children.length > 0

  function enqueueUpdate(patch, label) {
    enqueue({
      url: `${apiBase}/${node.id}`,
      method: 'PUT',
      body: patch,
      label,
      optimistic: { entity: 'task', op: 'update', scope: apiBase, id: node.id, patch },
    })
  }

  function setStatus(next) {
    if (!canChangeStatus || next === localStatus) return
    if (!statusAllowed(next)) { alert('You are not allowed to set this status.'); return }
    setLocalStatus(next)
    enqueueUpdate({ status: next }, `Set “${node.title}” to ${next}`)
  }

  function handleSaveEdit(form) {
    enqueueUpdate({
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
    }, `Save “${form.title}”`)
    setEditing(false)
  }

  // Deliberately NOT queued. The server is the only thing that knows whether a task ID
  // number is already taken, and the user has to be told before the dialog closes.
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

  function handleAddUpdate() {
    if (!updateText.trim()) return
    const existing = Array.isArray(node.updates) ? node.updates : []
    const newUpdate = {
      id: `upd-${Date.now()}`,
      text: updateText.trim(),
      author: updateAuthor.trim() || null,
      createdAt: new Date().toISOString(),
    }
    enqueueUpdate({ updates: [...existing, newUpdate] }, 'Post update')
    setUpdateText('')
  }

  function handleDelete() {
    const childCount = countDescendants(node)
    const msg = childCount > 0
      ? `Delete "${node.title}" and its ${childCount} sub-task(s)?`
      : `Delete "${node.title}"?`
    if (!confirm(msg)) return
    enqueue({
      url: `${apiBase}/${node.id}`,
      method: 'DELETE',
      label: `Delete “${node.title}”`,
      optimistic: { entity: 'task', op: 'delete', scope: apiBase, id: node.id },
    })
  }

  function handleArchive() {
    const childCount = countDescendants(node)
    // Only this task is archived. buildTree() re-roots orphaned children, so its
    // sub-tasks stay on the board rather than disappearing with the parent.
    const msg = childCount > 0
      ? `Archive "${node.title}"? Its ${childCount} sub-task(s) stay on the list as top-level tasks.`
      : `Archive "${node.title}"?`
    if (!confirm(msg)) return
    enqueueUpdate({ archived: true, archivedAt: new Date().toISOString() }, `Archive “${node.title}”`)
  }

  function handleAddChild(form, { keepOpen } = {}) {
    const draft = taskDraft({ ...form, parentId: node.id, numberOverride: form.numberOverride || null })
    enqueue({
      url: apiBase,
      method: 'POST',
      body: taskCreateBody(draft),
      label: `Add sub-task “${draft.title}”`,
      optimistic: { entity: 'task', op: 'create', scope: apiBase, data: draft },
    })
    if (!keepOpen) setAddingChild(false)
    setExpanded(true)
  }

  // A sub-task starts life looking like its parent — same column, priority, owners and
  // deadline — so the common case is title-then-Enter.
  function childDefaults() {
    return {
      ...blankForm(),
      status: localStatus,
      priority: node.priority || 'medium',
      assignees: nodeAssignees.map(a => (typeof a === 'object' ? a.name : a)),
      dueDate: node.dueDate || '',
    }
  }

  // Reorder swaps `order` with a sibling the client does not hold a reference to, so
  // there is no descriptor to replay — the move shows up when the queued PATCH lands
  // and tasks.js refetches. Still off the click path.
  function handleMove(direction) {
    enqueue({
      url: `${apiBase}/${node.id}`,
      method: 'PATCH',
      body: { direction },
      label: `Move “${node.title}” ${direction}`,
    })
  }

  const column = columns.find(c => c.status === localStatus)
  const statusLabel = column?.label || labelForStatus(localStatus) || 'To Do'
  const statusPill = statusPillProps(localStatus, column?.color)

  const { total: descTotal, done: descDone } = hasChildren ? getDescendantStats(node) : { total: 0, done: 0 }

  const dropZone = dnd?.dropTarget?.id === node.id ? dnd.dropTarget.zone : null

  return (
    <div className={`task-node${node.__context ? ' task-node--context' : ''}`} style={{ '--depth': depth }} data-depth={depth} data-group={hasChildren ? 'true' : undefined}>
      <div
        ref={rowRef}
        className={`task-row task-row--${localStatus}${localStatus === 'done' ? ' task-row-done' : ''}${dropZone ? ` task-row--drop-${dropZone}` : ''}${isFocused ? ' task-row--focused' : ''}`}
        onContextMenu={onContextMenu ? e => onContextMenu(e, node) : undefined}
        draggable={!!dnd}
        onDragStart={dnd ? e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', node.id); dnd.onDragStart(node.id) } : undefined}
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
          <span
            className="task-title task-title--clickable"
            onClick={() => { setShowDetail(true); setDetailEditing(false) }}
            title="Click for details"
            style={{ textDecoration: localStatus === 'done' ? 'line-through' : 'none', opacity: localStatus === 'done' ? 0.55 : 1 }}
          >
            {node.title}
          </span>
          {node.__context && <span className="task-context-tag" title="Shown as parent context">parent</span>}
          {coverSrc(node) && (
            <img src={coverSrc(node)} alt="cover" className="task-row-cover" title="Cover image" />
          )}
          {Array.isArray(node.attachments) && node.attachments.length > 0 && (
            <span className="task-meta-chip task-attach-chip" title={`${node.attachments.length} image(s)`}>🖼 {node.attachments.length}</span>
          )}
          {node.startDate && <span className="task-meta-chip task-start" title="Start date">▶ {formatDate(node.startDate)}</span>}
          {node.dueDate && <span className="task-meta-chip task-due" title="Due date">⏎ {formatDate(node.dueDate)}</span>}
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
        {node.seq != null && !hasChildren && (
          <span
            className={`task-id-badge${canEdit ? ' task-id-badge--editable' : ''}`}
            title={canEdit ? 'Click to edit task ID' : 'Task ID'}
            onClick={canEdit ? handleEditId : undefined}
          >{taskPrefix ? `${taskPrefix}-${node.seq}` : `#${node.seq}`}</span>
        )}
        <div className="task-row-actions">
          <button className="task-action-btn" onClick={copyLink} title="Copy link to this task">
            {copied ? '✓' : '🔗'}
          </button>
          {canEdit && dnd && <>
            <button className="task-action-btn task-action-btn--move" onClick={() => handleMove('up')} title="Move up">↑</button>
            <button className="task-action-btn task-action-btn--move" onClick={() => handleMove('down')} title="Move down">↓</button>
          </>}
          {canCreate && (
            <button className="task-action-btn" onClick={() => { setAddingChild(v => !v); setEditing(false) }} title="Add sub-task">+ sub</button>
          )}
          {canEdit && <>
            <button className="task-action-btn" onClick={() => { setEditing(v => !v); setAddingChild(false); setShowUpdates(false) }} title="Edit task">Edit</button>
            <button className={`task-action-btn ${showUpdates ? 'active' : ''}`} onClick={() => { setShowUpdates(v => !v); setEditing(false); setAddingChild(false) }} title="Updates">Updates</button>
          </>}
          {canEdit && (
            <button className="task-action-btn" onClick={handleArchive} title="Archive task">📦</button>
          )}
          {canDelete && (
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
              attachments: Array.isArray(node.attachments) ? node.attachments : [],
              cover: node.cover || null,
            }}
            onSave={handleSaveEdit}
            onCancel={() => setEditing(false)}
            label="Update"
            assignees={assignees}
            columns={columns}
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
            <SubmitButton
              className="btn-primary"
              onClick={handleAddUpdate}
              disabled={!updateText.trim()}
              busyLabel="Posting…"
              style={{ fontSize: 12, padding: '5px 12px', whiteSpace: 'nowrap' }}
            >
              Post
            </SubmitButton>
          </div>
        </div>
      )}

      {addingChild && (
        <div className="task-inline-form task-inline-form--sub">
          <TaskForm
            initial={childDefaults()}
            onSave={handleAddChild}
            onCancel={() => setAddingChild(false)}
            label="Add"
            assignees={assignees}
            showCreator
            currentUser={currentUser}
            quickAdd
            allowAddAnother
            columns={columns}
          />
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
                columns={columns}
              />
            ) : (
              <div className="task-detail">
                <div className="task-detail-title">{node.title}</div>
                <div className="task-detail-grid">
                  <div className="task-detail-field">
                    <span className="task-detail-label">Status</span>
                    {canChangeStatus ? (
                      <select className="form-input" value={localStatus} onChange={e => setStatus(e.target.value)} style={{ maxWidth: 180, fontSize: 12 }}>
                        {columns.map(c => <option key={c.status} value={c.status} disabled={!statusAllowed(c.status)}>{c.label}</option>)}
                      </select>
                    ) : (
                      <span {...statusPill} className={`${statusPill.className} task-detail-static`}>{statusLabel}</span>
                    )}
                  </div>
                  <div className="task-detail-field"><span className="task-detail-label">Priority</span><span>{PRIORITY_LABEL[node.priority] || node.priority || '—'}</span></div>
                  <div className="task-detail-field"><span className="task-detail-label">Start</span><span>{formatDate(node.startDate) || '—'}</span></div>
                  <div className="task-detail-field"><span className="task-detail-label">Due</span><span>{formatDate(node.dueDate) || '—'}</span></div>
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
                        <a key={att.id} href={attSrc(att)} target="_blank" rel="noopener noreferrer" title={att.name}>
                          <img src={attSrc(att)} alt={att.name} className="task-detail-thumb" />
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
            <TaskNode key={child.id} node={child} apiBase={apiBase} onRefresh={onRefresh} depth={depth + 1} assignees={assignees} currentUser={currentUser} dnd={dnd} taskAcl={taskAcl} taskPrefix={taskPrefix} onContextMenu={onContextMenu} columns={columns} focusId={focusId} expandSignal={expandSignal} />
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

export default function TaskTree({ tasks, apiBase, slug, onRefresh, currentUser, taskAcl, taskPrefix, focusTaskId }) {
  const [addingRoot, setAddingRoot] = useState(false)
  const [expandSignal, setExpandSignal] = useState(null)  // { n, value } broadcast to every TaskNode
  const [copiedAll, setCopiedAll] = useState(0)  // count of links in the last copy, 0 = idle
  const [ctxMenu, setCtxMenu] = useState(null)   // { x, y, task }
  const [historyTask, setHistoryTask] = useState(null)
  function handleContextMenu(e, task) {
    // Activity/history is viewable by anyone with project access.
    e.preventDefault()
    setCtxMenu({ x: e.clientX, y: e.clientY, task })
  }
  function taskLabel(t) {
    return taskPrefix && t.seq != null ? `${taskPrefix}-${t.seq}` : (t.number ? `#${t.number}` : '')
  }
  const savedColumns = useColumns(slug)
  const [assignees, setAssignees] = useState([])
  // Manual order is the default: it is the only sort where the rendered position matches
  // the `order` field that numbers (1.2.3, 1.2.4 …) are derived from, so a drag both
  // moves the row and renumbers it. Under newest/oldest the numbers look shuffled.
  const [sortBy, setSortBy] = useState('order')
  const [search, setSearch] = useState('')
  const [filterPerson, setFilterPerson] = useState('')
  const [filterStatuses, setFilterStatuses] = useState([])
  const [filterPriorities, setFilterPriorities] = useState([])
  const [startFrom, setStartFrom] = useState('')
  const [startTo, setStartTo] = useState('')
  const [dueFrom, setDueFrom] = useState('')
  const [dueTo, setDueTo] = useState('')
  const [dueDates, setDueDates] = useState([])   // specific YYYY-MM-DD picks
  const [showDuePicker, setShowDuePicker] = useState(false)
  const [duePickerPos, setDuePickerPos] = useState(null)  // {top,left} for fixed menu
  const duePickerRef = useRef(null)
  const dueBtnRef = useRef(null)
  const draggedId = useRef(null)
  const [dropTarget, setDropTarget] = useState(null)
  const [undoStack, setUndoStack] = useState([])   // snapshots of task positions, newest last
  const canReorder = hasPerm(currentUser, 'task:update')
  // Dragging writes `order`, which newest/oldest ignore — so drag is live in manual order
  // only, otherwise a drop would silently change nothing on screen.
  const canDrag = canReorder && sortBy === 'order'

  // Snapshot every task's parentId/order so a move can be reverted exactly.
  function snapshotPositions() {
    return (tasks || []).map(t => ({ id: t.id, parentId: t.parentId || null, order: t.order }))
  }

  function handleUndo() {
    setUndoStack(prev => {
      if (prev.length === 0) return prev
      const positions = prev[prev.length - 1]
      // The snapshot already is the target layout for every task, so it replays
      // directly as an optimistic multi-row update.
      const patches = Object.fromEntries(positions.map(p => [p.id, { parentId: p.parentId, order: p.order }]))
      enqueue({
        url: `${apiBase}/${positions[0]?.id || 'undo'}`,
        method: 'PATCH',
        body: { action: 'restorePositions', positions },
        label: 'Undo move',
        optimistic: { entity: 'task', op: 'updateMany', scope: apiBase, patches },
      })
      return prev.slice(0, -1)
    })
  }

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
      // Capture layout before mutating so Ctrl+Z / Undo can revert it.
      const snapshot = snapshotPositions()
      setUndoStack(prev => [...prev, snapshot].slice(-50))
      // The server recomputes parentId/order for the moved node and its new siblings;
      // reproducing that here would mean duplicating moveTask(). The drag is queued
      // instead, and the tree settles when the refetch lands.
      enqueue({
        url: `${apiBase}/${sourceId}`,
        method: 'PATCH',
        body: { action: 'move', targetId: nodeId, position: zone },
        label: 'Move task',
      })
    },
    onDragEnd() { draggedId.current = null; setDropTarget(null) },
  }

  // Ctrl+Z / Cmd+Z undoes the last drag-move (ignored while typing in a field).
  useEffect(() => {
    if (!canReorder) return
    function onKey(e) {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== 'z') return
      const tag = (e.target.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return
      e.preventDefault()
      handleUndo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canReorder, apiBase, onRefresh])

  useEffect(() => {
    fetch('/api/assignees').then(r => r.ok ? r.json() : []).then(setAssignees).catch(() => {})
  }, [])

  const liveTasks = (tasks || []).filter(t => !t.archived)
  const tree = buildTree(liveTasks, sortBy)

  // Distinct due dates present across tasks (YYYY-MM-DD), ascending.
  const availableDueDates = [...new Set(
    liveTasks.map(t => (t.dueDate || '').slice(0, 10)).filter(Boolean)
  )].sort()

  const q = search.toLowerCase()
  const pq = filterPerson.toLowerCase().trim()
  const isFiltering = q || pq || filterStatuses.length > 0 || filterPriorities.length > 0 || startFrom || startTo || dueFrom || dueTo || dueDates.length > 0
  const filtered = isFiltering
    ? liveTasks.filter(t => {
        const taskAssignees = Array.isArray(t.assignees) ? t.assignees : (t.assignee ? [t.assignee] : [])
        const matchesSearch = !q || (
          t.title.toLowerCase().includes(q) ||
          (t.description || '').toLowerCase().includes(q) ||
          taskAssignees.some(a => a.toLowerCase().includes(q)) ||
          (Array.isArray(t.updates) && t.updates.some(u => Array.isArray(u.mentions) && u.mentions.some(m => (m || '').toLowerCase().includes(q)))) ||
          (t.id || '').toString().toLowerCase().includes(q) ||
          (t.seq != null && t.seq.toString() === q) ||
          (t.seq != null && taskLabel(t).toLowerCase().includes(q)) ||
          (t.number || '').toString().includes(q) ||
          (t.autoNumber || '').toString().includes(q) ||
          (t.numberOverride || '').toString().includes(q)
        )
        const matchesPerson = !pq || taskAssignees.some(a => a.toLowerCase().includes(pq))
        const matchesStatus = filterStatuses.length === 0 || filterStatuses.includes(t.status || 'todo')
        const matchesPriority = filterPriorities.length === 0 || filterPriorities.includes(t.priority || 'medium')
        const sd = t.startDate || ''
        const matchesStart = (!startFrom || (sd && sd >= startFrom)) && (!startTo || (sd && sd <= startTo))
        const dd = t.dueDate || ''
        const matchesDue = (!dueFrom || (dd && dd >= dueFrom)) && (!dueTo || (dd && dd <= dueTo))
        const matchesDueSet = dueDates.length === 0 || dueDates.includes(dd.slice(0, 10))
        return matchesSearch && matchesPerson && matchesStatus && matchesPriority && matchesStart && matchesDue && matchesDueSet
      }).sort(TASK_COMPARATORS[sortBy] || TASK_COMPARATORS.order)
    : null
  // Matched tasks plus their ancestors, nested so parents give context to matched children.
  const filteredTree = filtered ? buildFilteredTree(liveTasks, filtered, sortBy) : null

  // Board columns first (including empty ones the user just added), then any status
  // a task carries that no column covers.
  const columns = columnsWithTaskStatuses(savedColumns, liveTasks)

  function clearFilters() {
    setSearch(''); setFilterPerson(''); setFilterStatuses([]); setFilterPriorities([])
    setStartFrom(''); setStartTo(''); setDueFrom(''); setDueTo(''); setDueDates([])
  }

  function toggleDueDate(d) {
    setDueDates(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d])
  }

  function toggleStatus(s) {
    setFilterStatuses(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])
  }

  function togglePriority(p) {
    setFilterPriorities(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])
  }

  function openDuePicker() {
    // Anchor the fixed-position menu under the button (menu is fixed so it
    // escapes the .section-card overflow:hidden clip).
    if (dueBtnRef.current) {
      const r = dueBtnRef.current.getBoundingClientRect()
      setDuePickerPos({ top: r.bottom + 4, left: r.left })
    }
    setShowDuePicker(true)
  }

  // Close the specific-dates popover on outside click / scroll / resize.
  useEffect(() => {
    if (!showDuePicker) return
    function onDocClick(e) {
      if (duePickerRef.current && !duePickerRef.current.contains(e.target)) setShowDuePicker(false)
    }
    function onDismiss() { setShowDuePicker(false) }
    document.addEventListener('mousedown', onDocClick)
    window.addEventListener('scroll', onDismiss, true)
    window.addEventListener('resize', onDismiss)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      window.removeEventListener('scroll', onDismiss, true)
      window.removeEventListener('resize', onDismiss)
    }
  }, [showDuePicker])

  // Copies one indented markdown link per task, in the order the tree renders them —
  // so a filtered/searched view exports exactly what is on screen.
  async function copyAllLinks() {
    const lines = []
    function walk(nodes, depth) {
      for (const n of nodes) {
        const id = taskLabel(n) || `#${n.number}`
        lines.push(`${'  '.repeat(depth)}- [${id} · ${n.title}](${taskShareLink(n.id)})`)
        walk(n.children || [], depth + 1)
      }
    }
    walk(filteredTree || tree, 0)
    if (!lines.length) return
    if (!(await copyText(lines.join('\n')))) return
    setCopiedAll(lines.length)
    setTimeout(() => setCopiedAll(0), 2000)
  }

  function broadcastExpand(value) {
    setExpandSignal(prev => ({ n: (prev?.n || 0) + 1, value }))
  }

  // Only tasks whose parent is still live actually nest — buildTree() re-roots the rest.
  const liveIds = new Set(liveTasks.map(t => t.id))
  const hasSubTasks = liveTasks.some(t => t.parentId && liveIds.has(t.parentId))

  function handleAddRoot(form) {
    const draft = taskDraft({ ...form, parentId: null, numberOverride: form.numberOverride || null })
    enqueue({
      url: apiBase,
      method: 'POST',
      body: taskCreateBody(draft),
      label: `Add task “${draft.title}”`,
      optimistic: { entity: 'task', op: 'create', scope: apiBase, data: draft },
    })
    setAddingRoot(false)
  }

  return (
    <div className="task-tree">
      <div className="task-tree-toolbar">
        {hasPerm(currentUser, 'task:create') && (
          <button className="btn-add-task" style={{ fontSize: 12, padding: '5px 12px' }} onClick={() => setAddingRoot(v => !v)}>
            {addingRoot ? 'Cancel' : '+ Add Task'}
          </button>
        )}
        {canReorder && (
          <button
            className="btn-ghost"
            onClick={handleUndo}
            disabled={undoStack.length === 0}
            style={{ fontSize: 12, padding: '5px 10px' }}
            title="Undo last drag move (Ctrl+Z)"
          >
            ↶ Undo{undoStack.length ? ` (${undoStack.length})` : ''}
          </button>
        )}
        {hasSubTasks && (
          <div className="tt-expand-group">
            <button
              className="btn-ghost"
              onClick={() => broadcastExpand(true)}
              style={{ fontSize: 12, padding: '5px 10px', whiteSpace: 'nowrap' }}
              title="Expand all sub-tasks"
            >
              ⊞ Expand all
            </button>
            <button
              className="btn-ghost"
              onClick={() => broadcastExpand(false)}
              style={{ fontSize: 12, padding: '5px 10px', whiteSpace: 'nowrap' }}
              title="Collapse all sub-tasks"
            >
              ⊟ Collapse all
            </button>
          </div>
        )}
        {liveTasks.length > 0 && (
          <button
            className="btn-ghost"
            onClick={copyAllLinks}
            style={{ fontSize: 12, padding: '5px 10px', whiteSpace: 'nowrap' }}
            title="Copy a shareable link for every task shown"
          >
            {copiedAll ? `✓ Copied ${copiedAll}` : '🔗 Copy links'}
          </button>
        )}
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
          <select
            className="form-input filter-select"
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            style={{ fontSize: 12, padding: '5px 8px' }}
            title={canReorder && sortBy !== 'order' ? 'Switch to Manual order to drag tasks' : 'Sort tasks'}
          >
            <option value="order">Manual order</option>
            <option value="newest">Latest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        )}
        {liveTasks.length > 0 && (
          <FilterMultiSelect
            label="Status"
            options={columns.map(c => ({ value: c.status, label: c.label }))}
            selected={filterStatuses}
            onToggle={toggleStatus}
            onClear={() => setFilterStatuses([])}
          />
        )}
        {liveTasks.length > 0 && (
          <FilterMultiSelect
            label="Priority"
            options={PRIORITY_ORDER.map(p => ({ value: p, label: p.charAt(0).toUpperCase() + p.slice(1) }))}
            selected={filterPriorities}
            onToggle={togglePriority}
            onClear={() => setFilterPriorities([])}
          />
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
        {liveTasks.length > 0 && availableDueDates.length > 0 && (
          <div className="tt-due-picker" ref={duePickerRef}>
            <button
              type="button"
              ref={dueBtnRef}
              className={`form-input filter-select tt-due-picker-btn${dueDates.length ? ' active' : ''}`}
              onClick={() => showDuePicker ? setShowDuePicker(false) : openDuePicker()}
              style={{ fontSize: 12, padding: '5px 8px' }}
              title="Pick specific due dates"
            >
              {dueDates.length ? `${dueDates.length} date${dueDates.length !== 1 ? 's' : ''}` : 'Pick dates'} ▾
            </button>
            {showDuePicker && (
              <div className="tt-due-picker-menu" style={duePickerPos ? { top: duePickerPos.top, left: duePickerPos.left } : undefined}>
                <div className="tt-due-picker-head">
                  <span>Due dates</span>
                  {dueDates.length > 0 && (
                    <button className="btn-ghost" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => setDueDates([])}>Clear</button>
                  )}
                </div>
                {availableDueDates.map(d => (
                  <label key={d} className="tt-due-picker-item">
                    <input type="checkbox" checked={dueDates.includes(d)} onChange={() => toggleDueDate(d)} />
                    <span>{formatDate(d)}</span>
                  </label>
                ))}
              </div>
            )}
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
          {columns.map(c => (
            <span key={c.status} className="status-legend-item">
              <span className="status-legend-dot" style={{ background: c.color }} />
              {c.label}
            </span>
          ))}
        </div>
      </div>

      {addingRoot && (
        <div className="task-inline-form" style={{ marginTop: 8 }}>
          <TaskForm onSave={handleAddRoot} onCancel={() => setAddingRoot(false)} label="Add Task" assignees={assignees} showCreator currentUser={currentUser} columns={columns} />
        </div>
      )}

      {filtered ? (
        filtered.length === 0 ? (
          <div className="empty-state-sm" style={{ padding: '24px 16px' }}>No tasks match the current filters.</div>
        ) : (
          <div className="task-list">
            {filteredTree.map(node => (
              <TaskNode key={node.id} node={node} apiBase={apiBase} onRefresh={onRefresh} depth={0} assignees={assignees} currentUser={currentUser} dnd={canDrag ? dnd : null} taskAcl={taskAcl} taskPrefix={taskPrefix} onContextMenu={handleContextMenu} columns={columns} focusId={focusTaskId} expandSignal={expandSignal} />
            ))}
          </div>
        )
      ) : tree.length === 0 && !addingRoot ? (
        <div className="empty-state-sm" style={{ padding: '24px 16px' }}>No tasks yet. Click "+ Add Task" to get started.</div>
      ) : (
        <div className="task-list">
          {tree.map(node => (
            <TaskNode key={node.id} node={node} apiBase={apiBase} onRefresh={onRefresh} depth={0} assignees={assignees} currentUser={currentUser} dnd={canDrag ? dnd : null} taskAcl={taskAcl} taskPrefix={taskPrefix} onContextMenu={handleContextMenu} columns={columns} focusId={focusTaskId} expandSignal={expandSignal} />
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
