import { useState, useEffect, useRef } from 'react'
import { apiFetch } from '../lib/api-fetch'
import AssigneeInput from './AssigneeInput'
import TaskContextMenu from './TaskContextMenu'
import TaskHistoryModal from './TaskHistoryModal'

const DEFAULT_COLUMNS = [
  { status: 'backlog',     label: 'Backlog',      color: '#94a3b8' },
  { status: 'todo',        label: 'To Do',        color: '#3b82f6' },
  { status: 'in-progress', label: 'In Progress',  color: '#f59e0b' },
  { status: 'in-review',   label: 'In Review',    color: '#8b5cf6' },
  { status: 'review',      label: 'Review',       color: '#d97706' },
  { status: 'blocked',     label: 'Blocked',      color: '#dc2626' },
  { status: 'done',        label: 'Done',         color: '#16a34a' },
]

const COL_COLORS = [
  '#94a3b8','#3b82f6','#f59e0b','#8b5cf6','#16a34a',
  '#ef4444','#ec4899','#06b6d4','#f97316','#84cc16',
]

const PRIORITY_COLOR = { low: '#64748b', medium: '#f59e0b', high: '#dc2626', critical: '#9f1239' }
const PRIORITY_LABEL = { low: 'Low', medium: 'Med', high: 'High', critical: 'Crit' }

const MAX_ATTACH_BYTES = 1024 * 1024 // 1MB cap per file (stored inline as data URL in Redis)

function isOverdue(dueDate) {
  if (!dueDate) return false
  return new Date(dueDate) < new Date()
}

function formatDate(d) {
  if (!d) return null
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Resolve @mentions in comment text against the assignee pool. Matches username,
// first name, or full name with spaces removed (all case-insensitive).
function parseMentions(text, people) {
  if (!text) return []
  const tokens = (text.match(/@[\w.\-]+/g) || []).map(t => t.slice(1).toLowerCase())
  if (!tokens.length) return []
  const hits = new Set()
  for (const p of (people || [])) {
    const uname = (p.username || '').toLowerCase()
    const first = (p.name || '').split(' ')[0].toLowerCase()
    const full = (p.name || '').toLowerCase().replace(/\s+/g, '')
    if (tokens.some(t => t && (t === uname || t === first || t === full))) hits.add(p.name)
  }
  return [...hits]
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
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
    labelIds: Array.isArray(task.labelIds) ? task.labelIds : [],
    attachments: Array.isArray(task.attachments) ? task.attachments : [],
    cover: task.cover || null,
    updates: Array.isArray(task.updates) ? task.updates : [],
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

export default function KanbanBoard({ tasks, apiBase, slug, onRefresh, currentUser, taskAcl, onAclChange, taskPrefix, onPrefixChange, taskSeqStart, onSeqStartChange }) {
  const storageKey = `kanban-cols:${apiBase}`

  // Full edit for admins; assignees may only change status of their own tasks.
  const canEditAll = !!currentUser?.isAdmin
  const isMine = task => !!currentUser?.name && (Array.isArray(task?.assignees) ? task.assignees : (task?.assignee ? [task.assignee] : []))
    .some(a => (typeof a === 'object' ? a?.name : a) === currentUser.name)
  const canChangeStatus = task => canEditAll || isMine(task)
  // Project ACL: which statuses a non-admin assignee may set (admins unrestricted).
  const statusAllowedForUser = status => {
    if (canEditAll) return true
    if (taskAcl?.assigneeCanChangeStatus === false) return false
    const list = taskAcl?.assigneeStatuses
    if (!Array.isArray(list)) return true
    return list.includes(status)
  }

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

  // Reconcile columns with statuses present in tasks. A task set (e.g. from the
  // calendar) to a status with no column would otherwise vanish from the board.
  useEffect(() => {
    const known = new Set(columns.map(c => c.status))
    const fallback = DEFAULT_COLUMNS.reduce((m, c) => (m[c.status] = c, m), {})
    const missing = []
    for (const t of tasks) {
      if (t.archived || !t.status || known.has(t.status)) continue
      known.add(t.status)
      missing.push(fallback[t.status] || {
        status: t.status,
        label: t.status.replace(/(^|-)([a-z])/g, (_, s, c) => (s ? ' ' : '') + c.toUpperCase()),
        color: COL_COLORS[(columns.length + missing.length) % COL_COLORS.length],
      })
    }
    if (missing.length) setColumns(prev => [...prev, ...missing])
  }, [tasks]) // eslint-disable-line react-hooks/exhaustive-deps

  const [draggingId, setDraggingId] = useState(null)
  const [dragOverStatus, setDragOverStatus] = useState(null)
  const [dragOverCard, setDragOverCard] = useState(null) // { id, pos: 'before' | 'after' }
  const [addingFor, setAddingFor] = useState(null)
  const [addForm, setAddForm] = useState(null)
  const [quickAddFor, setQuickAddFor] = useState(null)
  const [quickAddTitle, setQuickAddTitle] = useState('')
  const [subAddFor, setSubAddFor] = useState(null) // parent task id for inline sub-task add
  const [subAddForm, setSubAddForm] = useState({ title: '', priority: 'medium' })
  const [editingTask, setEditingTask] = useState(null)
  const [editForm, setEditForm] = useState(null)
  const [assignees, setAssignees] = useState([])
  const [labels, setLabels] = useState([])
  const [saving, setSaving] = useState(false)
  const [animatingOut, setAnimatingOut] = useState(new Set())
  const [kbSearch, setKbSearch] = useState('')
  const [kbPriority, setKbPriority] = useState('')
  const [kbStatus, setKbStatus] = useState('')
  const [kbDate, setKbDate] = useState('')
  const [kbPerson, setKbPerson] = useState('')
  const [kbLabel, setKbLabel] = useState('')

  // Comments
  const [commentText, setCommentText] = useState('')

  // Right-click activity/history (viewable by anyone with project access)
  const [ctxMenu, setCtxMenu] = useState(null)   // { x, y, task }
  const [historyTask, setHistoryTask] = useState(null)
  function handleCardContextMenu(e, task) {
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({ x: e.clientX, y: e.clientY, task })
  }
  function taskLabel(t) {
    return taskPrefix && t.seq != null ? `${taskPrefix}-${t.seq}` : (t.number ? `#${t.number}` : '')
  }

  // Label manager
  const [showLabelMgr, setShowLabelMgr] = useState(false)
  const [newLabel, setNewLabel] = useState({ name: '', color: COL_COLORS[1] })

  // Permissions (ACL) manager — admin sets which statuses assignees may set
  const [showAclMgr, setShowAclMgr] = useState(false)
  const [aclDraft, setAclDraft] = useState(null)
  const [savingAcl, setSavingAcl] = useState(false)

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

  const labelsApi = slug ? `/api/projects/${slug}/labels` : null
  const labelById = Object.fromEntries(labels.map(l => [l.id, l]))

  // Archived cards never show on the board.
  const boardTasks = tasks.filter(t => !t.archived)
  const taskById = Object.fromEntries(boardTasks.map(t => [t.id, t]))

  const STATUS_CYCLE = Object.fromEntries(
    columns.map((col, i) => [col.status, columns[(i + 1) % columns.length].status])
  )

  function matchesFilters(t) {
    const sq = kbSearch.toLowerCase()
    if (sq && !t.title.toLowerCase().includes(sq)) return false
    if (kbPriority && (t.priority || 'medium') !== kbPriority) return false
    if (kbStatus && t.status !== kbStatus) return false
    if (kbLabel && !(Array.isArray(t.labelIds) && t.labelIds.includes(kbLabel))) return false
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

  const hasKbFilters = kbSearch || kbPriority || kbStatus || kbDate || kbPerson || kbLabel
  const visibleTasks = hasKbFilters ? boardTasks.filter(matchesFilters) : boardTasks

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

  function loadLabels() {
    if (!labelsApi) return
    fetch(labelsApi).then(r => r.ok ? r.json() : []).then(setLabels).catch(() => {})
  }
  useEffect(() => { loadLabels() }, [labelsApi]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- Label management ---
  async function createLabel() {
    if (!newLabel.name.trim() || !labelsApi) return
    await apiFetch(labelsApi, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newLabel),
    })
    setNewLabel({ name: '', color: COL_COLORS[1] })
    loadLabels()
  }
  async function updateLabel(id, updates) {
    if (!labelsApi) return
    await apiFetch(`${labelsApi}?id=${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    loadLabels()
  }
  async function deleteLabel(id) {
    if (!labelsApi) return
    await apiFetch(`${labelsApi}?id=${id}`, { method: 'DELETE' })
    loadLabels()
  }

  // --- Permissions (ACL) management ---
  function openAclMgr() {
    // null assigneeStatuses means "all allowed" — seed the draft with every column checked.
    const list = Array.isArray(taskAcl?.assigneeStatuses) ? taskAcl.assigneeStatuses : columns.map(c => c.status)
    setAclDraft({
      assigneeCanChangeStatus: taskAcl?.assigneeCanChangeStatus !== false,
      assigneeStatuses: list,
      taskPrefix: taskPrefix || '',
      taskSeqStart: String(taskSeqStart || 1),
    })
    setShowAclMgr(true)
  }
  function toggleAclStatus(status) {
    setAclDraft(d => ({
      ...d,
      assigneeStatuses: d.assigneeStatuses.includes(status)
        ? d.assigneeStatuses.filter(s => s !== status)
        : [...d.assigneeStatuses, status],
    }))
  }
  async function saveAcl() {
    if (!slug || !aclDraft) return
    setSavingAcl(true)
    const payload = {
      assigneeCanChangeStatus: aclDraft.assigneeCanChangeStatus,
      assigneeStatuses: aclDraft.assigneeStatuses,
    }
    const prefix = (aclDraft.taskPrefix || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
    const start = Math.max(1, parseInt(aclDraft.taskSeqStart, 10) || 1)
    await apiFetch(`/api/projects/${slug}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskAcl: payload, taskPrefix: prefix, taskSeqStart: start }),
    })
    setSavingAcl(false)
    onAclChange?.(payload)
    onPrefixChange?.(prefix)
    onSeqStartChange?.(start)
    setShowAclMgr(false)
  }

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

  // Quick-add (Trello-style inline card composer)
  async function quickAdd(status) {
    if (!quickAddTitle.trim()) return
    await apiFetch(apiBase, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: quickAddTitle.trim(), status, priority: 'medium' }),
    })
    setQuickAddTitle('')
    onRefresh()
  }

  // Add a sub-task to an existing card on the board. Inherits the parent's status
  // so it renders nested under the parent.
  async function addSubtask(parent) {
    if (!subAddForm.title.trim()) return
    await apiFetch(apiBase, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: subAddForm.title.trim(),
        priority: subAddForm.priority || 'medium',
        status: parent.status,
        parentId: parent.id,
      }),
    })
    setSubAddFor(null)
    setSubAddForm({ title: '', priority: 'medium' })
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
            <option value="critical">Crit</option>
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
    setCommentText('')
  }

  function closeEdit() {
    setEditingTask(null)
    setEditForm(null)
    setCommentText('')
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

  async function archiveTask() {
    if (!editingTask) return
    setSaving(true)
    await apiFetch(`${apiBase}/${editingTask.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: true, archivedAt: new Date().toISOString() }),
    })
    setSaving(false)
    closeEdit()
    onRefresh()
  }

  async function postComment() {
    if (!commentText.trim() || !editingTask) return
    const newUpdate = {
      id: `upd-${Date.now()}`,
      text: commentText.trim(),
      author: currentUser?.name || currentUser?.username || null,
      mentions: parseMentions(commentText, assignees),
      createdAt: new Date().toISOString(),
    }
    const nextUpdates = [...(editForm.updates || []), newUpdate]
    setEditForm(p => ({ ...p, updates: nextUpdates }))
    setCommentText('')
    await apiFetch(`${apiBase}/${editingTask.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates: nextUpdates }),
    })
    onRefresh()
  }

  // --- Attachments / cover ---
  async function addAttachments(fileList) {
    const files = Array.from(fileList || [])
    if (!files.length) return
    const added = []
    for (const f of files) {
      if (f.size > MAX_ATTACH_BYTES) {
        alert(`"${f.name}" is too large (max ${Math.round(MAX_ATTACH_BYTES / 1024)}KB).`)
        continue
      }
      const dataUrl = await readFileAsDataUrl(f)
      added.push({
        id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: f.name,
        type: f.type,
        size: f.size,
        dataUrl,
        uploadedBy: currentUser?.name || null,
        uploadedAt: new Date().toISOString(),
      })
    }
    if (added.length) setEditForm(p => ({ ...p, attachments: [...(p.attachments || []), ...added] }))
  }
  function removeAttachment(id) {
    setEditForm(p => ({
      ...p,
      attachments: (p.attachments || []).filter(a => a.id !== id),
      cover: p.cover && p.cover.attId === id ? null : p.cover,
    }))
  }
  function setCover(att) {
    setEditForm(p => ({ ...p, cover: { dataUrl: att.dataUrl, attId: att.id } }))
  }
  function clearCover() {
    setEditForm(p => ({ ...p, cover: null }))
  }

  async function updateStatus(taskId, newStatus) {
    const task = boardTasks.find(t => t.id === taskId)
    if (!task || task.status === newStatus) return
    if (!canChangeStatus(task)) return
    if (!statusAllowedForUser(newStatus)) {
      alert('You are not allowed to move tasks to this status.')
      return
    }
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

  async function reorderColumn(status, orderedIds) {
    const draggedId = orderedIds[0] // any id in this column works as the path param
    await apiFetch(`${apiBase}/${draggedId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'boardReorder', status, orderedIds }),
    })
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
    setDragOverCard(null)
    dragTypeRef.current = null
  }

  // Within-column card drop target
  function onCardDragOver(e, task) {
    if (dragTypeRef.current !== 'task' || draggingId === task.id) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    const r = e.currentTarget.getBoundingClientRect()
    const pos = (e.clientY - r.top) / r.height < 0.5 ? 'before' : 'after'
    setDragOverCard(prev => (prev?.id === task.id && prev?.pos === pos) ? prev : { id: task.id, pos })
  }

  function onCardDrop(e, targetTask, colStatus) {
    if (dragTypeRef.current !== 'task') return
    e.preventDefault()
    e.stopPropagation()
    const dragged = taskById[draggingId]
    const pos = dragOverCard?.pos
    setDragOverCard(null)
    setDragOverStatus(null)
    const id = draggingId
    setDraggingId(null)
    dragTypeRef.current = null
    if (!dragged || dragged.id === targetTask.id) return
    if (dragged.status !== colStatus) {
      // cross-column drop on a card → move to that column (appended)
      updateStatus(id, colStatus)
      return
    }
    const ids = getColTasks(colStatus).map(t => t.id)
    const from = ids.indexOf(id)
    if (from !== -1) ids.splice(from, 1)
    let idx = ids.indexOf(targetTask.id)
    if (idx === -1) idx = ids.length
    if (pos === 'after') idx += 1
    ids.splice(idx, 0, id)
    reorderColumn(colStatus, ids)
  }

  function onDragEnd() {
    setDraggingId(null)
    setDragOverStatus(null)
    setDragOverCard(null)
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
    const taskCount = boardTasks.filter(t => t.status === status).length
    if (taskCount > 0) {
      alert(`Cannot delete: ${taskCount} task${taskCount !== 1 ? 's' : ''} in this column. Move them first.`)
      return
    }
    setColumns(prev => prev.filter(c => c.status !== status))
  }

  function toggleEditLabel(id) {
    setEditForm(p => ({
      ...p,
      labelIds: p.labelIds.includes(id)
        ? p.labelIds.filter(l => l !== id)
        : [...p.labelIds, id],
    }))
  }

  function sortBoard(arr) {
    return arr.sort((a, b) => (a.boardOrder ?? a.order) - (b.boardOrder ?? b.order))
  }

  function getColTasks(status) {
    return sortBoard(visibleTasks.filter(t => !t.parentId && t.status === status))
  }

  function getChildrenOf(taskId) {
    return boardTasks.filter(t => t.parentId === taskId).sort((a, b) => a.order - b.order)
  }

  function getChildrenInCol(taskId, colStatus) {
    return visibleTasks.filter(t => t.parentId === taskId && t.status === colStatus).sort((a, b) => a.order - b.order)
  }

  function getOrphanSubsInCol(colStatus) {
    return visibleTasks
      .filter(t => t.parentId && t.status === colStatus && taskById[t.parentId]?.status !== colStatus)
      .sort((a, b) => a.order - b.order)
  }

  function renderCardLabels(task) {
    const ids = Array.isArray(task.labelIds) ? task.labelIds : []
    if (!ids.length) return null
    return (
      <div className="kanban-card-labels">
        {ids.map(id => {
          const l = labelById[id]
          if (!l) return null
          return <span key={id} className="kanban-label-chip" style={{ background: l.color }} title={l.name}>{l.name}</span>
        })}
      </div>
    )
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
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select className="form-input filter-select" value={kbStatus} onChange={e => setKbStatus(e.target.value)}>
          <option value="">All statuses</option>
          {columns.map(c => <option key={c.status} value={c.status}>{c.label}</option>)}
        </select>
        {labels.length > 0 && (
          <select className="form-input filter-select" value={kbLabel} onChange={e => setKbLabel(e.target.value)}>
            <option value="">All labels</option>
            {labels.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        )}
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
        {labelsApi && (
          <button className="btn-ghost" style={{ whiteSpace: 'nowrap', fontSize: 12 }} onClick={() => setShowLabelMgr(true)}>
            🏷 Labels
          </button>
        )}
        {canEditAll && slug && (
          <button className="btn-ghost" style={{ whiteSpace: 'nowrap', fontSize: 12 }} onClick={openAclMgr} title="Task id prefix & assignee permissions">
            ⚙ Task Settings
          </button>
        )}
        {hasKbFilters && (
          <button className="btn-ghost" style={{ whiteSpace: 'nowrap', fontSize: 12 }} onClick={() => { setKbSearch(''); setKbPriority(''); setKbStatus(''); setKbDate(''); setKbPerson(''); setKbLabel('') }}>
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
                      {hasKbFilters ? `/${boardTasks.filter(t => t.status === col.status).length}` : ''}
                    </span>
                  </div>
                  {canEditAll && (
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
                  )}
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
                        <option value="critical">Critical</option>
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
                    const dropClass = dragOverCard?.id === task.id ? ` kanban-card--drop-${dragOverCard.pos}` : ''
                    return (
                      <div key={task.id} className={`kanban-card-group${animatingOut.has(task.id) ? ' kanban-card-group--leaving' : ''}`}>
                        <div
                          className={`kanban-card${draggingId === task.id ? ' kanban-card--dragging' : ''}${dropClass}`}
                          draggable
                          role="button"
                          tabIndex={0}
                          onClick={() => openEdit(task)}
                          onKeyDown={e => { if (e.key === 'Enter') openEdit(task) }}
                          onContextMenu={e => handleCardContextMenu(e, task)}
                          onDragStart={e => onDragStart(e, task.id)}
                          onDragOver={e => onCardDragOver(e, task)}
                          onDrop={e => onCardDrop(e, task, col.status)}
                          onDragEnd={onDragEnd}
                        >
                          {task.cover?.dataUrl && (
                            <div className="kanban-card-cover" style={{ backgroundImage: `url(${task.cover.dataUrl})` }} />
                          )}
                          {renderCardLabels(task)}
                          <div className="kanban-card-header">
                            {task.seq != null && <span className="task-id-badge" style={{ fontSize: 10 }}>{taskPrefix ? `${taskPrefix}-${task.seq}` : `#${task.seq}`}</span>}
                            {task.number && <span className="task-number" style={{ fontSize: 10 }}>{task.number}</span>}
                            {canEditAll && (
                              <button
                                className="kanban-card-edit-btn"
                                onClick={e => { e.stopPropagation(); openEdit(task) }}
                                title="Edit task"
                              >✎</button>
                            )}
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
                            {task.updates?.length > 0 && (
                              <span className="task-meta-chip" title={`${task.updates.length} comment(s)`}>💬 {task.updates.length}</span>
                            )}
                            {task.attachments?.length > 0 && (
                              <span className="task-meta-chip" title={`${task.attachments.length} attachment(s)`}>📎 {task.attachments.length}</span>
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
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => openEdit(sub)}
                                  onKeyDown={e => { if (e.key === 'Enter') openEdit(sub) }}
                                  onContextMenu={e => handleCardContextMenu(e, sub)}
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
                                      disabled={!canChangeStatus(sub)}
                                      onClick={e => e.stopPropagation()}
                                      onChange={e => { e.stopPropagation(); updateStatus(sub.id, e.target.value) }}
                                    >
                                      {columns.map(c => (
                                        <option key={c.status} value={c.status} disabled={!statusAllowedForUser(c.status)}>{c.label}</option>
                                      ))}
                                    </select>
                                    {canEditAll && (
                                      <button
                                        className="kanban-card-edit-btn"
                                        style={{ fontSize: 10, padding: '1px 4px' }}
                                        onClick={e => { e.stopPropagation(); openEdit(sub) }}
                                        title="Edit subtask"
                                      >✎</button>
                                    )}
                                  </span>
                                </div>
                              )
                            })}
                          </div>
                        )}

                        {canEditAll && (
                          subAddFor === task.id ? (
                            <div className="kanban-add-subtask-block kanban-inline-subtask-add">
                              <div className="kanban-add-subtask-row">
                                <span className="kanban-subtask-indent-arrow">↳</span>
                                <input
                                  className="form-input kanban-add-subtask-input"
                                  placeholder="Sub-task title"
                                  value={subAddForm.title}
                                  autoFocus
                                  onChange={e => setSubAddForm(p => ({ ...p, title: e.target.value }))}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') addSubtask(task)
                                    if (e.key === 'Escape') { setSubAddFor(null); setSubAddForm({ title: '', priority: 'medium' }) }
                                  }}
                                />
                                <select
                                  className="form-input kanban-add-subtask-priority"
                                  value={subAddForm.priority}
                                  onChange={e => setSubAddForm(p => ({ ...p, priority: e.target.value }))}
                                >
                                  <option value="low">Low</option>
                                  <option value="medium">Med</option>
                                  <option value="high">High</option>
                                  <option value="critical">Crit</option>
                                </select>
                              </div>
                              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                                <button className="btn-primary" style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => addSubtask(task)} disabled={!subAddForm.title.trim()}>Add</button>
                                <button className="btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => { setSubAddFor(null); setSubAddForm({ title: '', priority: 'medium' }) }}>✕</button>
                              </div>
                            </div>
                          ) : (
                            <button
                              className="kanban-add-subtask-btn kanban-add-subtask-btn--card"
                              onClick={() => { setSubAddFor(task.id); setSubAddForm({ title: '', priority: 'medium' }) }}
                            >+ sub-task</button>
                          )
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
                          role="button"
                          tabIndex={0}
                          onClick={() => openEdit(sub)}
                          onKeyDown={e => { if (e.key === 'Enter') openEdit(sub) }}
                          onContextMenu={e => handleCardContextMenu(e, sub)}
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
                              disabled={!canChangeStatus(sub)}
                              onClick={e => e.stopPropagation()}
                              onChange={e => { e.stopPropagation(); updateStatus(sub.id, e.target.value) }}
                            >
                              {columns.map(c => (
                                <option key={c.status} value={c.status} disabled={!statusAllowedForUser(c.status)}>{c.label}</option>
                              ))}
                            </select>
                            {canEditAll && (
                              <button
                                className="kanban-card-edit-btn"
                                style={{ fontSize: 10, padding: '1px 4px' }}
                                onClick={() => openEdit(sub)}
                                title="Edit subtask"
                              >✎</button>
                            )}
                          </span>
                        </div>
                      </div>
                    )
                  })}

                  {visibleTasks.filter(t => t.status === col.status).length === 0 && addingFor !== col.status && quickAddFor !== col.status && (
                    <div className="kanban-empty">No tasks</div>
                  )}

                  {/* Quick-add card composer */}
                  {quickAddFor === col.status ? (
                    <div className="kanban-quick-add">
                      <textarea
                        className="form-input"
                        placeholder="Enter a title…"
                        value={quickAddTitle}
                        autoFocus
                        rows={2}
                        onChange={e => setQuickAddTitle(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); quickAdd(col.status) }
                          if (e.key === 'Escape') { setQuickAddFor(null); setQuickAddTitle('') }
                        }}
                      />
                      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                        <button className="btn-primary" style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => quickAdd(col.status)} disabled={!quickAddTitle.trim()}>Add card</button>
                        <button className="btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => { setQuickAddFor(null); setQuickAddTitle('') }}>✕</button>
                      </div>
                    </div>
                  ) : canEditAll ? (
                    <button className="kanban-quick-add-btn" onClick={() => { setQuickAddFor(col.status); setQuickAddTitle('') }}>+ Add a card</button>
                  ) : null}
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
          ) : canEditAll ? (
            <button className="kanban-add-col-btn" onClick={() => setAddingCol(true)}>
              + Add column
            </button>
          ) : null}
        </div>
      </div>

      {/* Label manager modal */}
      {showLabelMgr && (
        <div className="kanban-modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowLabelMgr(false) }}>
          <div className="kanban-modal" style={{ maxWidth: 420 }}>
            <div className="kanban-modal-header">
              <span>Manage Labels</span>
              <button className="kanban-modal-close" onClick={() => setShowLabelMgr(false)}>✕</button>
            </div>
            <div className="task-form">
              <div className="kanban-label-mgr-list">
                {labels.length === 0 && <div className="kanban-empty" style={{ margin: 0 }}>No labels yet.</div>}
                {labels.map(l => (
                  <div key={l.id} className="kanban-label-mgr-row">
                    <span className="kanban-label-chip" style={{ background: l.color }}>{l.name}</span>
                    <div className="kanban-col-color-picker" style={{ flex: 1 }}>
                      {COL_COLORS.map(c => (
                        <button key={c} className={`kanban-col-color-swatch${l.color === c ? ' active' : ''}`} style={{ background: c }} onClick={() => updateLabel(l.id, { color: c })} title={c} />
                      ))}
                    </div>
                    <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => deleteLabel(l.id)} title="Delete label">✕</button>
                  </div>
                ))}
              </div>
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 4 }}>
                <input
                  className="form-input"
                  placeholder="New label name"
                  value={newLabel.name}
                  onChange={e => setNewLabel(p => ({ ...p, name: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') createLabel() }}
                />
                <div className="kanban-col-color-picker" style={{ marginTop: 8 }}>
                  {COL_COLORS.map(c => (
                    <button key={c} className={`kanban-col-color-swatch${newLabel.color === c ? ' active' : ''}`} style={{ background: c }} onClick={() => setNewLabel(p => ({ ...p, color: c }))} title={c} />
                  ))}
                </div>
                <button className="btn-primary" style={{ fontSize: 12, marginTop: 8 }} onClick={createLabel} disabled={!newLabel.name.trim()}>+ Add label</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Permissions (ACL) modal */}
      {showAclMgr && aclDraft && (
        <div className="kanban-modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowAclMgr(false) }}>
          <div className="kanban-modal" style={{ maxWidth: 440 }}>
            <div className="kanban-modal-header">
              <span>Task Settings</span>
              <button className="kanban-modal-close" onClick={() => setShowAclMgr(false)}>✕</button>
            </div>
            <div className="task-form">
              <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 12, marginBottom: 4 }}>
                <div className="task-assignees-label" style={{ marginBottom: 6 }}>Task ID prefix</div>
                <input
                  className="form-input"
                  placeholder="e.g. ENG, MED, CON, WAR"
                  value={aclDraft.taskPrefix}
                  maxLength={8}
                  onChange={e => setAclDraft(d => ({ ...d, taskPrefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') }))}
                  style={{ textTransform: 'uppercase' }}
                />
                <div className="task-assignees-label" style={{ margin: '12px 0 6px' }}>Start number</div>
                <input
                  className="form-input"
                  type="number"
                  min={1}
                  placeholder="1"
                  value={aclDraft.taskSeqStart}
                  onChange={e => setAclDraft(d => ({ ...d, taskSeqStart: e.target.value.replace(/[^0-9]/g, '') }))}
                />
                <p style={{ fontSize: 11, color: 'var(--muted)', margin: '6px 0 0' }}>
                  New tasks count up from the largest existing id, never below this number — e.g. <strong>{(aclDraft.taskPrefix || 'ENG')}-{aclDraft.taskSeqStart || '1'}</strong>. Only affects future tasks; existing ids never change.
                </p>
              </div>
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 4px' }}>
                Admins always have full control. These rules apply to members changing the status of tasks assigned to them.
              </p>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={aclDraft.assigneeCanChangeStatus}
                  onChange={e => setAclDraft(d => ({ ...d, assigneeCanChangeStatus: e.target.checked }))}
                />
                Allow assignees to change status
              </label>
              {aclDraft.assigneeCanChangeStatus && (
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 4 }}>
                  <div className="task-assignees-label" style={{ marginBottom: 8 }}>Statuses assignees may set:</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {columns.map(c => (
                      <label key={c.status} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                        <input
                          type="checkbox"
                          checked={aclDraft.assigneeStatuses.includes(c.status)}
                          onChange={() => toggleAclStatus(c.status)}
                        />
                        <span className="kanban-column-dot" style={{ background: c.color }} />
                        {c.label}
                      </label>
                    ))}
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--muted)', margin: '8px 0 0' }}>
                    Unchecked statuses can only be set by an admin.
                  </p>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
                <button className="btn-ghost" onClick={() => setShowAclMgr(false)}>Cancel</button>
                <button className="btn-primary" onClick={saveAcl} disabled={savingAcl}>Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

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

              {/* Labels */}
              {labels.length > 0 && (
                <div className="task-assignees-selector">
                  <span className="task-assignees-label">Labels:</span>
                  <div className="task-assignees-list">
                    {labels.map(l => (
                      <button
                        key={l.id}
                        type="button"
                        className="kanban-label-chip kanban-label-chip--toggle"
                        style={{ background: editForm.labelIds.includes(l.id) ? l.color : 'transparent', color: editForm.labelIds.includes(l.id) ? '#fff' : l.color, borderColor: l.color }}
                        onClick={() => toggleEditLabel(l.id)}
                      >
                        {editForm.labelIds.includes(l.id) ? '✓ ' : ''}{l.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

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
                  <option value="critical">Critical priority</option>
                </select>
              </div>
              <AssigneeInput
                value={editForm.assignees}
                options={assignees}
                onChange={next => setEditForm(p => ({ ...p, assignees: next }))}
              />
              <div className="task-assignees-selector">
                <span className="task-assignees-label">Assigned by:</span>
                <span style={{ fontSize: 12 }}>{editingTask.assignedBy || '—'}</span>
              </div>
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

              {/* Attachments + cover */}
              <div className="kanban-attach-section">
                <div className="task-assignees-label" style={{ marginBottom: 6 }}>Attachments:</div>
                {(editForm.attachments || []).length > 0 && (
                  <div className="kanban-attach-list">
                    {editForm.attachments.map(att => {
                      const isImg = (att.type || '').startsWith('image/')
                      const isCover = editForm.cover?.attId === att.id
                      return (
                        <div key={att.id} className="kanban-attach-item">
                          {isImg
                            ? <a href={att.dataUrl} target="_blank" rel="noopener noreferrer" title="View"><img src={att.dataUrl} alt={att.name} className="kanban-attach-thumb" /></a>
                            : <span className="kanban-attach-file">📄</span>}
                          <a href={att.dataUrl} target="_blank" rel="noopener noreferrer" className="kanban-attach-name" title={att.name}>{att.name}</a>
                          <a href={att.dataUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost" style={{ fontSize: 11 }} title="View">View</a>
                          <a href={att.dataUrl} download={att.name} className="btn-ghost" style={{ fontSize: 11 }} title="Download">Download</a>
                          {isImg && (
                            <button type="button" className="btn-ghost" style={{ fontSize: 11 }} onClick={() => isCover ? clearCover() : setCover(att)}>
                              {isCover ? 'Unset cover' : 'Set cover'}
                            </button>
                          )}
                          <button type="button" className="btn-ghost" style={{ fontSize: 11 }} onClick={() => removeAttachment(att.id)} title="Remove">✕</button>
                        </div>
                      )
                    })}
                  </div>
                )}
                <input type="file" multiple onChange={e => { addAttachments(e.target.files); e.target.value = '' }} style={{ fontSize: 12 }} />
              </div>

              {/* Comments / activity */}
              <div className="kanban-comments-section">
                <div className="task-assignees-label" style={{ marginBottom: 6 }}>Comments:</div>
                <div className="task-updates-list">
                  {(!editForm.updates || editForm.updates.length === 0) ? (
                    <div className="task-updates-empty">No comments yet.</div>
                  ) : (
                    [...editForm.updates].reverse().map(u => (
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
                    placeholder="Comment… use @name to mention"
                    value={commentText}
                    onChange={e => setCommentText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); postComment() } }}
                    style={{ flex: 1, fontSize: 12 }}
                  />
                  <button className="btn-primary" onClick={postComment} disabled={!commentText.trim()} style={{ fontSize: 12, padding: '5px 12px', whiteSpace: 'nowrap' }}>Post</button>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                <button className="btn-ghost" style={{ color: '#dc2626' }} onClick={archiveTask} disabled={saving} title="Archive this card">Archive</button>
                <div style={{ display: 'flex', gap: 8 }}>
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
