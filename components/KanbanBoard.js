import { useState, useEffect, useRef } from 'react'
import { enqueue, onSync } from '../lib/submit-queue'
import { taskDraft, taskCreateBody } from '../lib/task-draft'
import AssigneeInput from './AssigneeInput'
import AutoTextarea from './AutoTextarea'
import SubmitButton from './SubmitButton'
import MentionInput from './MentionInput'
import TaskContextMenu from './TaskContextMenu'
import TaskHistoryModal from './TaskHistoryModal'
import FilterMultiSelect, { DatePicker } from './FilterMultiSelect'
import { DEFAULT_COLUMNS, COL_COLORS, useColumns, saveColumns, labelForStatus } from '../lib/kanban-columns'
import { useCategories, categoriesWithTaskValues, categoryMap, effectiveCategory, taskIndex, railRollups, RAIL_STATE_LABEL } from '../lib/categories'
import CategoryManager from './CategoryManager'
import CellPeekModal from './CellPeekModal'
import { isSuperAdmin } from '../lib/client-permissions'
import { taskShareLink, copyText } from '../lib/task-link'
import { attSrc, coverSrc } from '../lib/attachment-src'

const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low']
const PRIORITY_COLOR = { low: '#64748b', medium: '#f59e0b', high: '#dc2626', critical: '#9f1239' }
const PRIORITY_LABEL = { low: 'Low', medium: 'Med', high: 'High', critical: 'Crit' }

const MAX_ATTACH_BYTES = 1024 * 1024 // 1MB cap per file (stored inline as data URL in Redis)

function blankSubForm() {
  return { title: '', description: '', priority: 'medium', status: 'todo', assignees: [], startDate: '', dueDate: '', labelIds: [] }
}

function isOverdue(dueDate) {
  if (!dueDate) return false
  return new Date(dueDate) < new Date()
}

function formatDate(d) {
  if (!d) return null
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Picker options are plain YYYY-MM-DD strings — parse them literally so a UTC
// midnight date never renders as the previous day.
function formatIsoDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || '')
  if (!m) return v
  const [, y, mo, d] = m
  return `${MONTH_ABBR[+mo - 1]} ${+d}, ${y}`
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
    category: task.category || '',
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

export default function KanbanBoard({ tasks, apiBase, slug, currentUser, taskAcl, onAclChange, taskPrefix, onPrefixChange, taskSeqStart, onSeqStartChange, focusTaskId }) {
  // Full edit for admins; assignees may only change status of their own tasks.
  const canEditAll = !!currentUser?.isAdmin
  const isMine = task => !!currentUser?.name && (Array.isArray(task?.assignees) ? task.assignees : (task?.assignee ? [task.assignee] : []))
    .some(a => (typeof a === 'object' ? a?.name : a) === currentUser.name)
  const canChangeStatus = task => canEditAll || isMine(task)
  // Global superadmin blocklist: statuses a regular user may never set (any project).
  // Admins/superadmin are exempt. Mirrors the server check in the task update route.
  const isPriv = !!currentUser?.isAdmin
  const restrictedStatuses = new Set(currentUser?.restrictedStatuses || [])
  // Project ACL: which statuses a non-admin assignee may set (admins unrestricted).
  const statusAllowedForUser = status => {
    if (!isPriv && restrictedStatuses.has(status)) return false
    if (canEditAll) return true
    if (taskAcl?.assigneeCanChangeStatus === false) return false
    const list = taskAcl?.assigneeStatuses
    if (!Array.isArray(list)) return true
    return list.includes(status)
  }

  // The column layout is global per project and owned by super admins; everyone
  // else sees it read-only. `columns` mirrors the server copy so an edit paints
  // immediately, then reverts if the PUT is rejected.
  const canEditColumns = isSuperAdmin(currentUser)
  // Categories are the board's second axis (rails, once the swimlane view lands);
  // here they are read for the card chip, the edit form and the filter.
  const savedCategories = useCategories(slug)
  const [showCatMgr, setShowCatMgr] = useState(false)
  // Rescue any category id a task still carries after its definition was deleted,
  // exactly as the column reconciliation below does for a stray status.
  const categories = categoriesWithTaskValues(savedCategories, tasks)
  const catById = categoryMap(categories)
  // Resolved against the *whole* task list, not the filtered one, so a sub-task
  // still inherits from an ancestor the current filter hides.
  const catTaskIndex = taskIndex(tasks)
  const catOf = task => effectiveCategory(task, catTaskIndex)
  const serverColumns = useColumns(slug)
  const [columns, setColumns] = useState(serverColumns)
  const [colError, setColError] = useState('')

  useEffect(() => { setColumns(serverColumns) }, [serverColumns])

  function commitColumns(next) {
    setColumns(next)
    setColError('')
    // Saving broadcasts, so the task list and calendar pick the change up live.
    saveColumns(slug, next).catch(err => {
      setColError(err.message || 'Could not save columns')
      setColumns(serverColumns)
    })
  }

  // Reconcile columns with statuses present in tasks. A task set (e.g. from the
  // calendar) to a status with no column would otherwise vanish from the board.
  // Local only — a stray status must not rewrite the shared layout, and only a
  // super admin could persist it anyway.
  useEffect(() => {
    // Resolve against `prev`, not the render's `columns`: this effect and the
    // sync above can fire in the same commit, and a status the incoming server
    // copy already defines must not be appended a second time.
    setColumns(prev => {
      const known = new Set(prev.map(c => c.status))
      const fallback = DEFAULT_COLUMNS.reduce((m, c) => (m[c.status] = c, m), {})
      const missing = []
      for (const t of tasks) {
        if (t.archived || !t.status || known.has(t.status)) continue
        known.add(t.status)
        missing.push(fallback[t.status] || {
          status: t.status,
          label: labelForStatus(t.status),
          color: COL_COLORS[(prev.length + missing.length) % COL_COLORS.length],
        })
      }
      return missing.length ? [...prev, ...missing] : prev
    })
  }, [tasks, serverColumns]) // eslint-disable-line react-hooks/exhaustive-deps

  const [draggingId, setDraggingId] = useState(null)
  const [dragOverStatus, setDragOverStatus] = useState(null)
  const [dragOverCard, setDragOverCard] = useState(null) // { id, pos: 'before' | 'after' }
  const [swimOver, setSwimOver] = useState(null)         // "rootId|railId|status" of the hovered cell
  // The overflow popup. Holds the *coordinates* of a cell, never a task list, so
  // moving a task out of the cell from inside the popup drops it from the popup
  // too instead of leaving a stale row behind.
  const [cellPeek, setCellPeek] = useState(null)         // { rootId, railId, status, laneTitle, railName }
  const [addingFor, setAddingFor] = useState(null)
  const [addForm, setAddForm] = useState(null)
  const [quickAddFor, setQuickAddFor] = useState(null)
  const [quickAddTitle, setQuickAddTitle] = useState('')
  const [quickAddLabels, setQuickAddLabels] = useState([])
  const [subAddFor, setSubAddFor] = useState(null) // parent task id for inline sub-task add
  const [subAddForm, setSubAddForm] = useState(blankSubForm())
  const [subAddAnother, setSubAddAnother] = useState(false)    // keep the modal open after Add
  const subTitleRef = useRef(null)
  const [editingTask, setEditingTask] = useState(null)
  const [editStack, setEditStack] = useState([])   // task ids visited before the current one
  const [editForm, setEditForm] = useState(null)
  const [assignees, setAssignees] = useState([])
  const [labels, setLabels] = useState([])
  const [animatingOut, setAnimatingOut] = useState(new Set())
  const [kbSearch, setKbSearch] = useState('')
  const [kbPriorities, setKbPriorities] = useState([])   // multi-select
  const [kbStatuses, setKbStatuses] = useState([])       // multi-select
  const [kbDate, setKbDate] = useState('')
  const [kbStartFrom, setKbStartFrom] = useState('')
  const [kbStartTo, setKbStartTo] = useState('')
  const [kbDueFrom, setKbDueFrom] = useState('')
  const [kbDueTo, setKbDueTo] = useState('')
  const [kbDueDates, setKbDueDates] = useState([])       // specific YYYY-MM-DD picks
  const [kbPerson, setKbPerson] = useState('')
  const [kbLabel, setKbLabel] = useState('')
  const [kbCategories, setKbCategories] = useState([])    // multi-select

  function toggleKbCategory(c) {
    setKbCategories(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c])
  }

  // Board layout: plain columns, or swimlanes (story lane › category rail › status
  // column). A per-project preference, not a shared setting — unlike the column
  // layout itself, how you like to read the board is nobody else's business.
  const layoutKey = slug ? `kanban-layout:${slug}` : null
  const lanesKey = slug ? `kanban-lanes-collapsed:${slug}` : null
  // Two different axes, two different keys. `lanesKey` is which lane bodies are
  // hidden; `expandKey` is which lanes show every card instead of one card plus
  // a "+N more" chip.
  const expandKey = slug ? `kanban-lanes-expanded:${slug}` : null
  const subLaneKey = slug ? `kanban-sublane:${slug}` : null
  const [layout, setLayout] = useState('columns')
  // Sub-lane axis inside an open lane: category rails, or none — one row of
  // status cells per lane, which is the plain "story › status" board.
  const [subLane, setSubLane] = useState('category')
  const [collapsedLanes, setCollapsedLanes] = useState(() => new Set())
  // Lanes showing every card in every cell. Absent from this set is the default:
  // one card per cell with the rest behind "+N more".
  const [expandedLanes, setExpandedLanes] = useState(() => new Set())

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const l = layoutKey && localStorage.getItem(layoutKey)
      setLayout(l === 'swimlanes' ? 'swimlanes' : 'columns')
      const s = subLaneKey && localStorage.getItem(subLaneKey)
      setSubLane(s === 'none' ? 'none' : 'category')
      const c = lanesKey && localStorage.getItem(lanesKey)
      const parsed = c && JSON.parse(c)
      setCollapsedLanes(new Set(Array.isArray(parsed) ? parsed : []))
      const x = expandKey && localStorage.getItem(expandKey)
      const parsedX = x && JSON.parse(x)
      setExpandedLanes(new Set(Array.isArray(parsedX) ? parsedX : []))
    } catch { /* first run, or storage disabled */ }
  }, [layoutKey, lanesKey, expandKey, subLaneKey])

  function chooseLayout(next) {
    setLayout(next)
    try { if (layoutKey) localStorage.setItem(layoutKey, next) } catch {}
  }

  function chooseSubLane(next) {
    setSubLane(next)
    try { if (subLaneKey) localStorage.setItem(subLaneKey, next) } catch {}
  }

  function persistLanes(set) {
    try { if (lanesKey) localStorage.setItem(lanesKey, JSON.stringify([...set])) } catch {}
  }

  function toggleLane(id) {
    setCollapsedLanes(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      persistLanes(next)
      return next
    })
  }

  function persistExpanded(set) {
    try { if (expandKey) localStorage.setItem(expandKey, JSON.stringify([...set])) } catch {}
  }

  // Expanding a lane implies opening it: "show every card" says nothing while the
  // lane body is hidden behind the caret. Collapsing only re-caps the cells — the
  // body stays open, because the "+N more" chips are the point of the collapsed
  // state and a hidden body has none.
  function toggleLaneExpanded(id) {
    const expand = !expandedLanes.has(id)
    setExpandedLanes(prev => {
      const next = new Set(prev)
      if (expand) next.add(id); else next.delete(id)
      persistExpanded(next)
      return next
    })
    if (expand && collapsedLanes.has(id)) {
      setCollapsedLanes(prev => {
        const next = new Set(prev)
        next.delete(id)
        persistLanes(next)
        return next
      })
    }
  }

  // The caret axis, in bulk: hide every lane's tasks down to its bar, or show
  // them all again. Writes the same set the carets write, so a lane's own caret
  // reflects it immediately.
  function setAllLanesCollapsed(collapse, ids) {
    const next = new Set(collapse ? ids : [])
    setCollapsedLanes(next)
    persistLanes(next)
  }

  // The global control drives the same per-lane state the carets write, so the
  // two never disagree: after "Expand all" every lane's own chip reads Collapse.
  function setAllLanesExpanded(expand, ids) {
    const next = new Set(expand ? ids : [])
    setExpandedLanes(next)
    persistExpanded(next)
    // Either direction opens every body — expanded lanes have to show their
    // cards, and a collapsed-all board still has to show its "+N more" chips.
    const open = new Set()
    setCollapsedLanes(open)
    persistLanes(open)
  }

  function toggleKbStatus(s) {
    setKbStatuses(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])
  }
  function toggleKbPriority(p) {
    setKbPriorities(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])
  }
  function toggleKbDueDate(d) {
    setKbDueDates(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d])
  }
  function clearKbFilters() {
    setKbSearch(''); setKbPriorities([]); setKbStatuses([]); setKbDate('')
    setKbStartFrom(''); setKbStartTo(''); setKbDueFrom(''); setKbDueTo(''); setKbDueDates([])
    setKbPerson(''); setKbLabel(''); setKbCategories([])
  }

  // Comments
  const [commentText, setCommentText] = useState('')

  // Updates panel — reachable straight from a card, no edit rights needed.
  const [updatesFor, setUpdatesFor] = useState(null)   // task id
  const [updateText, setUpdateText] = useState('')

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

  // Share links
  const [copiedId, setCopiedId] = useState(null)  // card whose link was just copied
  const [copiedAll, setCopiedAll] = useState(0)   // links in the last bulk copy, 0 = idle
  const focusCardRef = useRef(null)

  useEffect(() => {
    if (!focusTaskId || !focusCardRef.current) return
    focusCardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
  }, [focusTaskId, tasks.length])

  async function copyCardLink(e, task) {
    e.stopPropagation()
    if (!(await copyText(taskShareLink(task.id)))) return
    setCopiedId(task.id)
    setTimeout(() => setCopiedId(null), 1500)
  }

  // One indented markdown link per visible card, walking each column top-down so the
  // export mirrors the board — and so an active filter exports only what is on screen.
  async function copyAllLinks() {
    const lines = []
    function walk(task, col, depth) {
      const id = taskLabel(task) || `#${task.number}`
      lines.push(`${'  '.repeat(depth)}- [${id} · ${task.title}](${taskShareLink(task.id)})`)
      for (const kid of getChildrenInCol(task.id, col.status)) walk(kid, col, depth + 1)
    }
    for (const col of columns) {
      const cards = [...getColTasks(col.status), ...getOrphanSubsInCol(col.status)]
      if (!cards.length) continue
      lines.push(`\n### ${col.label}`)
      for (const card of cards) walk(card, col, 0)
    }
    if (!lines.length) return
    if (!(await copyText(lines.join('\n').trim()))) return
    setCopiedAll(lines.filter(l => l.trimStart().startsWith('- ')).length)
    setTimeout(() => setCopiedAll(0), 2000)
  }

  // Label manager
  const [showLabelMgr, setShowLabelMgr] = useState(false)
  const [newLabel, setNewLabel] = useState({ name: '', color: COL_COLORS[1] })

  // Permissions (ACL) manager — admin sets which statuses assignees may set
  const [showAclMgr, setShowAclMgr] = useState(false)
  const [aclDraft, setAclDraft] = useState(null)

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
  // Every new task must carry at least one label — but only once the project has
  // labels to pick from, otherwise the first task in a new project is impossible
  // to create. Mirrors lib/require-label.js, which is what actually enforces it;
  // this is here so the form says no before the server has to.
  const labelsRequired = labels.length > 0
  const hasLabels = ids => Array.isArray(ids) && ids.length > 0
  const labelsOk = ids => !labelsRequired || hasLabels(ids)

  // Archived cards never show on the board.
  const boardTasks = tasks.filter(t => !t.archived)
  const taskById = Object.fromEntries(boardTasks.map(t => [t.id, t]))

  const STATUS_CYCLE = Object.fromEntries(
    columns.map((col, i) => [col.status, columns[(i + 1) % columns.length].status])
  )

  function matchesFilters(t) {
    const sq = kbSearch.toLowerCase().trim()
    const searchAssignees = Array.isArray(t.assignees)
      ? t.assignees.some(a => ((typeof a === 'object' ? a?.name : a) || '').toLowerCase().includes(sq))
      : false
    // @mentions of a person in this card's comments/updates also count as a match.
    const searchMentions = Array.isArray(t.updates)
      ? t.updates.some(u => Array.isArray(u.mentions) && u.mentions.some(m => (m || '').toLowerCase().includes(sq)))
      : false
    // If the query matches a real user's name, treat it as a person search: surface
    // ONLY tasks that person is on (assignee or @mention), never tasks that merely
    // contain the name in their title/description.
    const isPersonQuery = !!sq && assignees.some(p => (p.name || '').toLowerCase().includes(sq))
    if (sq) {
      if (isPersonQuery) {
        if (!(searchAssignees || searchMentions)) return false
      } else if (!(
        t.title.toLowerCase().includes(sq) ||
        (t.id || '').toString().toLowerCase().includes(sq) ||
        (t.seq != null && t.seq.toString() === sq) ||
        (t.seq != null && taskLabel(t).toLowerCase().includes(sq)) ||
        (t.number || '').toString().includes(sq) ||
        (t.autoNumber || '').toString().includes(sq) ||
        (t.numberOverride || '').toString().includes(sq) ||
        searchAssignees ||
        searchMentions
      )) return false
    }
    if (kbPriorities.length && !kbPriorities.includes(t.priority || 'medium')) return false
    if (kbStatuses.length && !kbStatuses.includes(t.status || 'todo')) return false
    if (kbLabel && !(Array.isArray(t.labelIds) && t.labelIds.includes(kbLabel))) return false
    if (kbCategories.length && !kbCategories.includes(catOf(t) || '')) return false
    const sd = (t.startDate || '').slice(0, 10)
    if (kbStartFrom && !(sd && sd >= kbStartFrom)) return false
    if (kbStartTo && !(sd && sd <= kbStartTo)) return false
    const dd = (t.dueDate || '').slice(0, 10)
    if (kbDueFrom && !(dd && dd >= kbDueFrom)) return false
    if (kbDueTo && !(dd && dd <= kbDueTo)) return false
    if (kbDueDates.length && !kbDueDates.includes(dd)) return false
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

  // Distinct due dates present on the board (YYYY-MM-DD), ascending — the "Pick dates" options.
  const availableDueDates = [...new Set(
    boardTasks.map(t => (t.dueDate || '').slice(0, 10)).filter(Boolean)
  )].sort()

  const hasKbFilters = !!(kbSearch || kbPriorities.length || kbStatuses.length || kbDate ||
    kbStartFrom || kbStartTo || kbDueFrom || kbDueTo || kbDueDates.length || kbPerson || kbLabel ||
    kbCategories.length)
  // Strict match: show ONLY the cards that themselves match. A matched sub-task whose
  // parent did not match renders as an orphan card with a parent breadcrumb (via
  // getOrphanSubsInCol) — the non-matching parent is not drawn as its own card. So
  // searching a person surfaces exactly the tasks that person is on (assignee/@mention),
  // never the parent as a bare context card.
  const matchIds = new Set(boardTasks.filter(matchesFilters).map(t => t.id))
  function isVisible(t) {
    if (!hasKbFilters) return true
    return matchIds.has(t.id)
  }
  const visibleTasks = boardTasks.filter(isVisible)
  const visibleIds = new Set(visibleTasks.map(t => t.id))

  // Grab-to-pan, on both boards. Anything that is itself draggable or clickable is
  // excluded — the preventDefault below would otherwise swallow the card's own
  // dragstart, and a lane title that pans instead of opening is a broken link.
  function onBoardMouseDown(e) {
    if (e.target.closest('.kanban-card') || e.target.closest('.kanban-subtask-row') ||
        e.target.closest('button') || e.target.closest('input') || e.target.closest('select') ||
        e.target.closest('.kanban-column-header') ||
        e.target.closest('.swim-lane-title') || e.target.closest('.swim-head')) return
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

  // Labels are few and rarely edited, so rather than maintain an optimistic overlay
  // for them, just refetch when a queued label write reaches the server.
  useEffect(() => onSync(item => {
    if (labelsApi && item.url.startsWith(labelsApi)) loadLabels()
  }), [labelsApi]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- Label management ---
  function createLabel() {
    if (!newLabel.name.trim() || !labelsApi) return
    enqueue({ url: labelsApi, method: 'POST', body: newLabel, label: `Create label “${newLabel.name.trim()}”` })
    setNewLabel({ name: '', color: COL_COLORS[1] })
  }
  function updateLabel(id, updates) {
    if (!labelsApi) return
    enqueue({ url: `${labelsApi}?id=${id}`, method: 'PUT', body: updates, label: 'Update label' })
  }
  function deleteLabel(id) {
    if (!labelsApi) return
    enqueue({ url: `${labelsApi}?id=${id}`, method: 'DELETE', label: 'Delete label' })
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
  function saveAcl() {
    if (!slug || !aclDraft) return
    const payload = {
      assigneeCanChangeStatus: aclDraft.assigneeCanChangeStatus,
      assigneeStatuses: aclDraft.assigneeStatuses,
    }
    const prefix = (aclDraft.taskPrefix || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
    const start = Math.max(1, parseInt(aclDraft.taskSeqStart, 10) || 1)
    enqueue({
      url: `/api/projects/${slug}`,
      method: 'PUT',
      body: { taskAcl: payload, taskPrefix: prefix, taskSeqStart: start },
      label: 'Save task settings',
    })
    onAclChange?.(payload)
    onPrefixChange?.(prefix)
    onSeqStartChange?.(start)
    setShowAclMgr(false)
  }

  function startAdding(status) {
    setAddingFor(status)
    setAddForm({ title: '', status, priority: 'medium', labelIds: [], children: [] })
  }

  function toggleAddLabel(id) {
    setAddForm(p => {
      const ids = Array.isArray(p.labelIds) ? p.labelIds : []
      return { ...p, labelIds: ids.includes(id) ? ids.filter(l => l !== id) : [...ids, id] }
    })
  }

  // Queue a task create and return the draft, so callers can reference the new id
  // immediately — before the POST has been sent, let alone answered.
  function enqueueCreate(fields, label) {
    const draft = taskDraft(fields)
    enqueue({
      url: apiBase,
      method: 'POST',
      body: taskCreateBody(draft),
      label: label || `Add card “${draft.title}”`,
      optimistic: { entity: 'task', op: 'create', scope: apiBase, data: draft },
    })
    return draft
  }

  function saveNew() {
    if (!addForm?.title.trim()) return
    if (!labelsOk(addForm.labelIds)) return
    const status = addForm.status

    // Children used to wait on their parent's POST to learn its id. Now the id is
    // generated up front, so the whole subtree is queued in one synchronous pass and
    // the FIFO drain guarantees a parent is committed before its children reference it.
    // Sub-tasks inherit the root's labels: labels are mandatory, and asking for them
    // again on every nested row of a composer would make the composer unusable.
    function queueTree(node, parentId) {
      const draft = enqueueCreate({
        title: node.title,
        priority: node.priority,
        status,
        labelIds: node.labelIds || addForm.labelIds || [],
        ...(parentId ? { parentId } : {}),
      })
      for (const child of (node.children || [])) {
        if (child.title.trim()) queueTree(child, draft.id)
      }
    }
    queueTree(addForm, null)

    setAddingFor(null)
    setAddForm(null)
  }

  // Quick-add (Trello-style inline card composer). Labels are mandatory, so this is
  // no longer strictly title-then-Enter — but the chips stay picked between cards,
  // so adding ten "backend" cards in a row is still one pick and ten titles.
  function quickAdd(status) {
    if (!quickAddTitle.trim()) return
    if (!labelsOk(quickAddLabels)) return
    enqueueCreate({ title: quickAddTitle, status, priority: 'medium', labelIds: quickAddLabels })
    setQuickAddTitle('')
  }

  function toggleQuickLabel(id) {
    setQuickAddLabels(ids => ids.includes(id) ? ids.filter(l => l !== id) : [...ids, id])
  }

  // Says why the Add button is dead, next to the thing that would revive it. A
  // disabled button with no explanation is the worst version of this rule.
  function renderLabelHint(ids) {
    if (labelsOk(ids)) return null
    return <div className="kanban-label-required">Pick at least one label</div>
  }

  // A sub-task starts life looking like its parent — same column, priority, owners,
  // deadline and labels — so the common case is title-then-Enter.
  function openSubAdd(parent) {
    setSubAddFor(parent.id)
    setSubAddForm({
      ...blankSubForm(),
      status: parent.status,
      priority: parent.priority || 'medium',
      assignees: Array.isArray(parent.assignees) ? [...parent.assignees] : [],
      dueDate: parent.dueDate || '',
      labelIds: Array.isArray(parent.labelIds) ? [...parent.labelIds] : [],
    })
  }

  function closeSubAdd() {
    setSubAddFor(null)
    setSubAddForm(blankSubForm())
  }

  function toggleSubLabel(id) {
    setSubAddForm(p => {
      const ids = Array.isArray(p.labelIds) ? p.labelIds : []
      return { ...p, labelIds: ids.includes(id) ? ids.filter(l => l !== id) : [...ids, id] }
    })
  }

  // Add a sub-task to an existing card on the board.
  function addSubtask(parent) {
    if (!parent || !subAddForm.title.trim()) return
    if (!labelsOk(subAddForm.labelIds)) return
    enqueueCreate({
      ...subAddForm,
      startDate: subAddForm.startDate || null,
      dueDate: subAddForm.dueDate || null,
      parentId: parent.id,
    }, `Add sub-task “${subAddForm.title.trim()}”`)
    if (!subAddAnother) { closeSubAdd(); return }
    // Keep the inherited defaults; clear what was unique to the task just added.
    setSubAddForm(p => ({ ...p, title: '', description: '' }))
    requestAnimationFrame(() => subTitleRef.current?.focus())
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
    setEditStack([])
    setEditingTask(task)
    setEditForm(toEditForm(task))
    setCommentText('')
  }

  function isEditDirty() {
    if (!editingTask || !editForm) return false
    return JSON.stringify(editForm) !== JSON.stringify(toEditForm(editingTask))
  }

  // Jump to another task from inside the modal (breadcrumb click), remembering
  // where we came from so the back arrow can return.
  function navEdit(task) {
    if (!task || task.id === editingTask?.id) return
    if (isEditDirty() && !confirm('Discard unsaved changes to this task?')) return
    if (editingTask) setEditStack(s => [...s, editingTask.id])
    setEditingTask(task)
    setEditForm(toEditForm(task))
    setCommentText('')
  }

  function backEdit() {
    const prevId = editStack[editStack.length - 1]
    const prev = prevId && taskById[prevId]
    if (!prev) return
    if (isEditDirty() && !confirm('Discard unsaved changes to this task?')) return
    setEditStack(s => s.slice(0, -1))
    setEditingTask(prev)
    setEditForm(toEditForm(prev))
    setCommentText('')
  }

  function closeEdit() {
    setEditStack([])
    setEditingTask(null)
    setEditForm(null)
    setCommentText('')
  }

  // Queue a partial update to a task on this board.
  function enqueueUpdate(taskId, patch, label) {
    enqueue({
      url: `${apiBase}/${taskId}`,
      method: 'PUT',
      body: patch,
      label,
      optimistic: { entity: 'task', op: 'update', scope: apiBase, id: taskId, patch },
    })
  }

  function saveEdit() {
    if (!editForm?.title.trim() || !editingTask) return
    // The select's empty option means "inherit", which is stored as null — an empty
    // string would work by accident (falsy) but reads as a real value in redis.
    const body = { ...editForm, category: editForm.category || null }
    enqueueUpdate(editingTask.id, body, `Save card “${editForm.title.trim()}”`)
    closeEdit()
  }

  function archiveTask() {
    if (!editingTask) return
    enqueueUpdate(
      editingTask.id,
      { archived: true, archivedAt: new Date().toISOString() },
      `Archive card “${editingTask.title}”`,
    )
    closeEdit()
  }

  function makeUpdate(text) {
    return {
      id: `upd-${Date.now()}`,
      text: text.trim(),
      author: currentUser?.name || currentUser?.username || null,
      mentions: parseMentions(text, assignees),
      createdAt: new Date().toISOString(),
    }
  }

  function postComment() {
    if (!commentText.trim() || !editingTask) return
    const nextUpdates = [...(editForm.updates || []), makeUpdate(commentText)]
    setEditForm(p => ({ ...p, updates: nextUpdates }))
    setCommentText('')
    enqueueUpdate(editingTask.id, { updates: nextUpdates }, 'Post comment')
  }

  // Post from the card's Updates panel. The patch carries only `updates`, so the
  // server's self-service path lets a non-admin assignee post without task edit rights.
  function postUpdate(task) {
    if (!updateText.trim() || !task) return
    const existing = Array.isArray(task.updates) ? task.updates : []
    enqueueUpdate(task.id, { updates: [...existing, makeUpdate(updateText)] }, 'Post update')
    setUpdateText('')
  }

  function openUpdates(e, task) {
    e.stopPropagation()
    setUpdatesFor(task.id)
    setUpdateText('')
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
    // Reference only — the bytes already live on the attachment, and storing a
    // second copy here doubled every covered image in redis and on the wire.
    setEditForm(p => ({ ...p, cover: { attId: att.id } }))
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
    // The wait here is the card's leave animation, not the database.
    setAnimatingOut(prev => new Set([...prev, taskId]))
    enqueueUpdate(taskId, { status: newStatus }, `Move “${task.title}” to ${newStatus}`)
    await new Promise(r => setTimeout(r, 180))
    setAnimatingOut(prev => { const s = new Set(prev); s.delete(taskId); return s })
  }

  function reorderColumn(status, orderedIds) {
    const draggedId = orderedIds[0] // any id in this column works as the path param
    const patches = Object.fromEntries(orderedIds.map((id, i) => [id, { boardOrder: i }]))
    enqueue({
      url: `${apiBase}/${draggedId}`,
      method: 'PATCH',
      body: { action: 'boardReorder', status, orderedIds },
      label: 'Reorder column',
      optimistic: { entity: 'task', op: 'updateMany', scope: apiBase, patches },
    })
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

  // Column drag (reorder) — super admin only; the order is shared by all users.
  function onColDragStart(e, status) {
    if (!canEditColumns) return
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
    if (canEditColumns && draggingColStatus && draggingColStatus !== toStatus) {
      const arr = [...columns]
      const fromIdx = arr.findIndex(c => c.status === draggingColStatus)
      const toIdx = arr.findIndex(c => c.status === toStatus)
      if (fromIdx !== -1 && toIdx !== -1) {
        const [col] = arr.splice(fromIdx, 1)
        arr.splice(toIdx, 0, col)
        commitColumns(arr)
      }
    }
    setDraggingColStatus(null)
    setDragOverColStatus(null)
    dragTypeRef.current = null
  }

  // Column CRUD — super admin only, and every change is global.
  function addColumn() {
    if (!canEditColumns || !newColForm.label.trim()) return
    const status = slugify(newColForm.label.trim(), columns.map(c => c.status))
    commitColumns([...columns, { status, label: newColForm.label.trim(), color: newColForm.color }])
    setNewColForm({ label: '', color: COL_COLORS[0] })
    setAddingCol(false)
  }

  function startRenameCol(status, currentLabel) {
    if (!canEditColumns) return
    setEditingColStatus(status)
    setEditingColLabel(currentLabel)
  }

  function commitRenameCol(status) {
    if (canEditColumns && editingColLabel.trim()) {
      commitColumns(columns.map(c => c.status === status ? { ...c, label: editingColLabel.trim() } : c))
    }
    setEditingColStatus(null)
    setEditingColLabel('')
  }

  function changeColColor(status, color) {
    if (!canEditColumns) return
    commitColumns(columns.map(c => c.status === status ? { ...c, color } : c))
  }

  function deleteColumn(status) {
    if (!canEditColumns) return
    const taskCount = boardTasks.filter(t => t.status === status).length
    if (taskCount > 0) {
      alert(`Cannot delete: ${taskCount} task${taskCount !== 1 ? 's' : ''} in this column. Move them first.`)
      return
    }
    commitColumns(columns.filter(c => c.status !== status))
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

  // Walk parentId chain to the top-level card. Grandchildren (sub-of-sub) must
  // group under their top-level ancestor, else the board (which only draws
  // top-level cards) never renders them anywhere.
  function topAncestorId(taskId) {
    let cur = taskById[taskId]
    const seen = new Set()
    while (cur && cur.parentId && taskById[cur.parentId] && !seen.has(cur.id)) {
      seen.add(cur.id)
      cur = taskById[cur.parentId]
    }
    return cur ? cur.id : taskId
  }

  // Ancestors of a task, root-first (excludes the task itself). Cycle-guarded
  // the same way topAncestorId is, since parentId comes from the store.
  function ancestorChain(task) {
    const out = []
    const seen = new Set([task.id])
    let cur = task.parentId ? taskById[task.parentId] : null
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id)
      out.unshift(cur)
      cur = cur.parentId ? taskById[cur.parentId] : null
    }
    return out
  }

  function directChildren(taskId) {
    return boardTasks.filter(t => t.parentId === taskId).sort((a, b) => a.order - b.order)
  }

  // All transitive descendants of a top-level card (not just direct children),
  // so deeply nested sub-tasks show up in the progress badge and on the board.
  function getChildrenOf(taskId) {
    return boardTasks
      .filter(t => t.parentId && topAncestorId(t.id) === taskId)
      .sort((a, b) => a.order - b.order)
  }

  // Nearest ancestor that is itself drawn in this column. A grandchild nests
  // under its parent when the parent shares the column, otherwise it climbs to
  // whichever ancestor does. Null => nothing above it is here, so it renders
  // top-level with a parent breadcrumb.
  function nearestAncestorInCol(task, colStatus) {
    const seen = new Set([task.id])
    let cur = task.parentId ? taskById[task.parentId] : null
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id)
      if (cur.status === colStatus && visibleIds.has(cur.id)) return cur.id
      cur = cur.parentId ? taskById[cur.parentId] : null
    }
    return null
  }

  function getChildrenInCol(taskId, colStatus) {
    return visibleTasks
      .filter(t => t.parentId && t.status === colStatus && nearestAncestorInCol(t, colStatus) === taskId)
      .sort((a, b) => a.order - b.order)
  }

  function getOrphanSubsInCol(colStatus) {
    return visibleTasks
      .filter(t => t.parentId && t.status === colStatus && nearestAncestorInCol(t, colStatus) === null)
      .sort((a, b) => a.order - b.order)
  }

  // --- Swimlanes ---
  // A lane is a *root* task, never a mid-level parent: nesting lanes inside lanes
  // is unreadable, and this data nests arbitrarily deep. Everything below a root
  // is a flat card in the lane, placed by its own category and status.
  const LOOSE_LANE = '__none'

  // Every rail row is the same height whatever it holds, so the grid stays a grid
  // and a lane with one busy cell does not tower over its neighbours. Cards past
  // this point live behind the "+N more" chip.
  const SWIM_CELL_VISIBLE = 1

  function swimLanes() {
    const byRoot = new Map()
    const stray = []
    for (const t of visibleTasks) {
      if (!t.parentId) continue
      const top = topAncestorId(t.id)
      // A task whose parent chain is broken resolves to itself — it has nowhere to
      // nest, so it belongs with the unparented cards rather than nowhere at all.
      if (top === t.id) { stray.push(t); continue }
      if (!byRoot.has(top)) byRoot.set(top, [])
      byRoot.get(top).push(t)
    }
    const roots = boardTasks.filter(t => !t.parentId)
    const lanes = sortBoard(roots.filter(r => byRoot.has(r.id)))
      .map(r => ({ root: r, cards: byRoot.get(r.id) }))
    const laneIds = new Set(lanes.map(l => l.root.id))
    // Roots with no visible descendants are cards, not lanes — otherwise a flat
    // project renders as one empty seven-column lane per task.
    const loose = sortBoard([
      ...visibleTasks.filter(t => !t.parentId && !laneIds.has(t.id)),
      ...stray,
    ])
    return { lanes, loose }
  }

  // Rails shown inside an open lane: every configured category (so each is a drop
  // target even at zero), plus Uncategorised only when something is actually in it.
  function railsFor(cards) {
    // No sub-lane axis: the lane body is a single row of status cells, and
    // `null` is the rail id that means "every card in this lane, uncategorised
    // or not". Distinct from '', which is the Uncategorised rail.
    if (subLane === 'none') return [{ id: null, name: null, color: null }]
    const rails = categories.map(c => ({ id: c.id, name: c.name, color: c.color, orphan: c.orphan }))
    if (cards.some(t => !catOf(t))) rails.push({ id: '', name: 'Uncategorised', color: null })
    return railRollups(rails.length ? rails : [{ id: '', name: 'Uncategorised', color: null }], cards, catOf)
  }

  function swimCell(cards, railId, status) {
    return sortBoard(cards.filter(t =>
      (railId === null || (catOf(t) || '') === railId) && (t.status || 'todo') === status
    ))
  }

  const swimKey = (rootId, railId, status) => `${rootId}|${railId === null ? '*' : railId}|${status}`

  function onSwimDrop(e, rootId, railId, status) {
    if (dragTypeRef.current !== 'task') return
    e.preventDefault()
    e.stopPropagation()
    const id = draggingId
    const dragged = taskById[id]
    setDraggingId(null)
    setSwimOver(null)
    setDragOverStatus(null)
    dragTypeRef.current = null
    if (!dragged) return

    // One gesture, up to three fields — but only the ones that actually changed.
    const patch = {}
    if ((dragged.status || 'todo') !== status) patch.status = status
    // railId null => rails are switched off, so this gesture says nothing about
    // the card's category and must leave it alone.
    if (railId !== null && (catOf(dragged) || '') !== railId) patch.category = railId || null
    const curLane = dragged.parentId ? topAncestorId(dragged.id) : null
    const nextLane = rootId === LOOSE_LANE ? null : rootId
    if (curLane !== nextLane) {
      if (nextLane === dragged.id) return   // a task cannot be its own parent
      patch.parentId = nextLane
    }
    if (!Object.keys(patch).length) return

    if ('status' in patch && !statusAllowedForUser(patch.status)) {
      alert('You are not allowed to set this status.')
      return
    }
    // Assignees may move their own card between columns; changing its category or
    // its story is an edit, which is admin-only.
    if (!canEditAll && Object.keys(patch).some(k => k !== 'status')) {
      alert('Only an admin can change a task’s category or story.')
      return
    }
    // Landing in a new lane *and* a new rail rewrites both axes at once. That is
    // the one move worth stopping for.
    if ('parentId' in patch && 'category' in patch) {
      const laneName = nextLane ? (taskById[nextLane]?.title || 'another story') : 'No story'
      const railName = railId ? (catById[railId]?.name || railId) : 'Uncategorised'
      if (!confirm(`Move “${dragged.title}” to ${laneName} › ${railName}?`)) return
    }
    enqueueUpdate(id, patch, `Move “${dragged.title}”`)
  }

  // Dropping *onto a card* inside a swim cell. Two different gestures land here:
  // reordering among the cards already in this cell, and a card arriving from
  // somewhere else that happened to land on a card rather than on empty space.
  // Only the first is a reorder; the second is the cell's move, so it delegates
  // rather than quietly rewriting boardOrder on a task that never joined the cell.
  function onSwimCardDrop(e, targetTask, status, swim) {
    if (dragTypeRef.current !== 'task') return
    e.preventDefault()
    e.stopPropagation()
    const id = draggingId
    const pos = dragOverCard?.pos
    setDragOverCard(null)
    if (!id || id === targetTask.id) {
      setDraggingId(null)
      setSwimOver(null)
      dragTypeRef.current = null
      return
    }
    // From another cell → let the cell's own rules decide what gets written
    // (status, category, story). onSwimDrop clears the drag state itself.
    if (!swim.ids.includes(id)) {
      onSwimDrop(e, swim.rootId, swim.railId, status)
      return
    }
    const ids = swim.ids.filter(x => x !== id)
    let idx = ids.indexOf(targetTask.id)
    if (idx === -1) idx = ids.length
    if (pos === 'after') idx += 1
    ids.splice(idx, 0, id)
    setDraggingId(null)
    setSwimOver(null)
    dragTypeRef.current = null
    reorderColumn(status, ids)
  }

  function onSwimDragOver(e, rootId, railId, status) {
    if (dragTypeRef.current !== 'task') return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const key = swimKey(rootId, railId, status)
    setSwimOver(prev => (prev === key ? prev : key))
  }

  // One grid template for the header row and every rail, so the columns line up
  // across every lane without repeating the column labels on each one. With rails
  // off there is no gutter to reserve, so the statuses take the full width.
  // Fixed column tracks, never `1fr`. The board is `min-width: max-content` so it
  // can be wider than its scroller — and under max-content sizing a `1fr` track
  // resolves to its content, so one long task title stretched its whole column to
  // fit on a single line and pushed every other status off-screen.
  const swimGrid = {
    gridTemplateColumns: subLane === 'none'
      ? `repeat(${columns.length}, var(--swim-col-w))`
      : `var(--swim-rail-w) repeat(${columns.length}, var(--swim-col-w))`,
  }

  function railTitle(rail) {
    if (rail.orphan) return 'This category is no longer configured'
    const lines = [`${rail.name} — ${RAIL_STATE_LABEL[rail.state]}`]
    if (rail.total) lines.push(`${rail.done} of ${rail.total} done`)
    if (rail.waitingOn.length) lines.push(`Waiting on ${rail.waitingOn.join(', ')}`)
    return lines.join('\n')
  }

  // How many cards a lane keeps behind its "+N more" chips at the default cap.
  // Drives the lane's own expand chip, so it can say what expanding will reveal.
  function laneHiddenCount(cards) {
    let hidden = 0
    for (const rail of railsFor(cards)) {
      for (const col of columns) {
        const len = swimCell(cards, rail.id, col.status).length
        if (len > SWIM_CELL_VISIBLE) hidden += len - SWIM_CELL_VISIBLE
      }
    }
    return hidden
  }

  function renderSwimRail(rootId, rail, cards, expanded) {
    return (
      <div
        className={`swim-rail${expanded ? ' swim-rail--expanded' : ''}`}
        style={swimGrid}
        key={`${rootId}|${rail.id === null ? '*' : rail.id}`}
      >
        {rail.id !== null && (
          <div
            className={[
              'swim-rail-label',
              rail.id ? '' : 'swim-rail-label--none',
              `swim-rail-label--${rail.state}`,
            ].filter(Boolean).join(' ')}
            style={rail.color ? { borderLeftColor: rail.color } : undefined}
            title={railTitle(rail)}
          >
            <div className="swim-rail-top">
              <span className="swim-rail-name">{rail.name}</span>
              <span className="swim-rail-count">{rail.done}/{rail.total}</span>
            </div>
            <span className="swim-rail-meter" aria-hidden="true">
              <span className="swim-rail-meter-fill" style={{ width: `${rail.pct}%` }} />
            </span>
            <span className={`swim-rail-state swim-rail-state--${rail.state}`}>
              {RAIL_STATE_LABEL[rail.state]}
            </span>
          </div>
        )}
        {columns.map(col => {
          const cell = swimCell(cards, rail.id, col.status)
          const hot = swimOver === swimKey(rootId, rail.id, col.status)
          const swim = { rootId, railId: rail.id, ids: cell.map(t => t.id) }
          return (
            <div
              key={col.status}
              className={`swim-cell${hot ? ' swim-cell--over' : ''}${cell.length ? '' : ' swim-cell--empty'}`}
              onDragOver={e => onSwimDragOver(e, rootId, rail.id, col.status)}
              onDrop={e => onSwimDrop(e, rootId, rail.id, col.status)}
              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setSwimOver(null) }}
            >
              {(expanded ? cell : cell.slice(0, SWIM_CELL_VISIBLE))
                .map(t => renderTaskCard(t, col, { orphan: true, flat: true, swim }))}
              {!expanded && cell.length > SWIM_CELL_VISIBLE && (
                <button
                  className="swim-more"
                  title={`${cell.length} tasks here — click to manage them`}
                  onClick={() => setCellPeek({
                    rootId,
                    railId: rail.id,
                    status: col.status,
                    laneTitle: rootId === LOOSE_LANE ? 'No story' : (taskById[rootId]?.title || 'Story'),
                    railName: rail.id === null ? null : (rail.name || 'Uncategorised'),
                  })}
                >
                  +{cell.length - SWIM_CELL_VISIBLE}
                  <span className="swim-more-word">more</span>
                </button>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  // Recomputed from the cell's coordinates on every render rather than captured
  // when the popup opened, so a status change made inside the popup takes the
  // task out of the list exactly as it takes it out of the cell behind.
  function cellPeekTasks(peek) {
    const { lanes, loose } = swimLanes()
    const cards = peek.rootId === LOOSE_LANE
      ? loose
      : (lanes.find(l => l.root.id === peek.rootId)?.cards || [])
    return swimCell(cards, peek.railId, peek.status)
  }

  function renderCellPeek() {
    const col = columns.find(c => c.status === cellPeek.status)
    return (
      <CellPeekModal
        tasks={cellPeekTasks(cellPeek)}
        columns={columns}
        statusLabel={col?.label || cellPeek.status}
        statusColor={col?.color}
        laneTitle={cellPeek.laneTitle}
        railName={cellPeek.railName}
        taskPrefix={taskPrefix}
        formatDate={formatDate}
        isOverdue={isOverdue}
        labelById={labelById}
        subCount={t => {
          const kids = getDescendantsOf(t.id)
          return { done: kids.filter(k => k.status === 'done').length, total: kids.length }
        }}
        canSetStatus={canChangeStatus}
        statusAllowed={statusAllowedForUser}
        onSetStatus={(t, next) => {
          if (!statusAllowedForUser(next)) { alert('You are not allowed to set this status.'); return }
          enqueueUpdate(t.id, { status: next }, `Move “${t.title}”`)
        }}
        onOpen={t => { setCellPeek(null); openEdit(t) }}
        onClose={() => setCellPeek(null)}
      />
    )
  }

  function renderSwimBoard(board) {
    const { lanes, loose } = board
    if (!lanes.length && !loose.length) {
      return <div className="kanban-empty">No tasks match the current filters.</div>
    }
    return (
      <div
        ref={boardWrapperRef}
        className="swim-board-wrapper"
        onMouseDown={onBoardMouseDown}
        onMouseMove={onBoardMouseMove}
        onMouseUp={onBoardMouseUp}
        onMouseLeave={onBoardMouseUp}
      >
        <div className="swim-board">
          <div className="swim-head" style={swimGrid}>
            {subLane !== 'none' && <div className="swim-head-corner">Category</div>}
            {columns.map(col => (
              <div key={col.status} className="swim-head-col">
                <span className="kanban-column-dot" style={{ background: col.color }} />
                <span>{col.label}</span>
              </div>
            ))}
          </div>

          {lanes.map(({ root, cards }) => {
            const collapsed = collapsedLanes.has(root.id)
            const expanded = expandedLanes.has(root.id)
            const hidden = laneHiddenCount(cards)
            const done = cards.filter(t => t.status === 'done').length
            const pct = cards.length ? Math.round((done / cards.length) * 100) : 0
            const rootCol = columns.find(c => c.status === root.status)
            return (
              <div className="swim-lane" key={root.id}>
                {/* The story is the lane, never a card — its status and progress
                    live here instead of in a column. */}
                {/* The bar spans the whole board so its tint runs the full width,
                    but everything *in* it rides a sticky inner cluster — the board
                    is several screens wide, and a right-aligned progress chip on a
                    2000px bar is a progress chip nobody ever sees. */}
                <div className="swim-lane-bar">
                  <div className="swim-lane-bar-inner">
                    <button
                      className="swim-lane-caret"
                      onClick={() => toggleLane(root.id)}
                      aria-expanded={!collapsed}
                      title={collapsed ? 'Expand lane' : 'Collapse lane'}
                    >{collapsed ? '▶' : '▼'}</button>
                    {root.number && <span className="task-number">{root.number}</span>}
                    <span
                      className="swim-lane-title"
                      role="button"
                      tabIndex={0}
                      onClick={() => openEdit(root)}
                      onKeyDown={e => { if (e.key === 'Enter') openEdit(root) }}
                      title="Open story"
                    >{root.title}</span>
                    <span className="swim-lane-kind">Story</span>
                    {rootCol && (
                      <span className="swim-lane-status" style={{ background: rootCol.color }}>{rootCol.label}</span>
                    )}
                    <span
                      className="swim-lane-prog"
                      title={`${pct}% of “${root.title}” complete`}
                    >
                      <span className="swim-lane-meter" aria-hidden="true">
                        <span className="swim-lane-meter-fill" style={{ width: `${pct}%` }} />
                      </span>
                      {done} / {cards.length} done
                    </span>
                    {root.assignees?.map(a => (
                      <span key={a} className="kanban-assignee-avatar swim-lane-avatar" title={a}>
                        {a.charAt(0).toUpperCase()}
                      </span>
                    ))}
                    <button
                      className={`swim-lane-expand${expanded ? ' swim-lane-expand--on' : ''}`}
                      onClick={() => toggleLaneExpanded(root.id)}
                      aria-pressed={expanded}
                      title={expanded
                        ? 'Collapse this story — cap each cell and bring back the “+N more” chips'
                        : hidden
                          ? `Expand this story — show all ${cards.length} tasks (${hidden} behind “+N more”)`
                          : 'Expand this story — show every task in each cell'}
                    >
                      {expanded ? '⤡ Collapse' : `⤢ Expand${hidden ? ` +${hidden}` : ''}`}
                    </button>
                  </div>
                </div>
                {!collapsed && railsFor(cards).map(rail => renderSwimRail(root.id, rail, cards, expanded))}
              </div>
            )
          })}

          {loose.length > 0 && (
            <div className="swim-lane">
              <div className="swim-lane-bar swim-lane-bar--loose">
                <div className="swim-lane-bar-inner">
                  <button
                    className="swim-lane-caret"
                    onClick={() => toggleLane(LOOSE_LANE)}
                    aria-expanded={!collapsedLanes.has(LOOSE_LANE)}
                    title={collapsedLanes.has(LOOSE_LANE) ? 'Expand lane' : 'Collapse lane'}
                  >{collapsedLanes.has(LOOSE_LANE) ? '▶' : '▼'}</button>
                  <span className="swim-lane-title swim-lane-title--loose">No story</span>
                  <span className="swim-lane-prog">{loose.length} task{loose.length !== 1 ? 's' : ''}</span>
                  {(() => {
                    const expanded = expandedLanes.has(LOOSE_LANE)
                    const hidden = laneHiddenCount(loose)
                    return (
                      <button
                        className={`swim-lane-expand${expanded ? ' swim-lane-expand--on' : ''}`}
                        onClick={() => toggleLaneExpanded(LOOSE_LANE)}
                        aria-pressed={expanded}
                        title={expanded
                          ? 'Collapse — cap each cell and bring back the “+N more” chips'
                          : hidden
                            ? `Expand — show all ${loose.length} tasks (${hidden} behind “+N more”)`
                            : 'Expand — show every task in each cell'}
                      >
                        {expanded ? '⤡ Collapse' : `⤢ Expand${hidden ? ` +${hidden}` : ''}`}
                      </button>
                    )
                  })()}
                </div>
              </div>
              {!collapsedLanes.has(LOOSE_LANE) && railsFor(loose).map(rail =>
                renderSwimRail(LOOSE_LANE, rail, loose, expandedLanes.has(LOOSE_LANE)))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // Solid when the card owns the category, outlined when it only inherits it from
  // an ancestor — same distinction the list view draws.
  function renderCardCategory(task) {
    const id = catOf(task)
    if (!id) return null
    const def = catById[id]
    const own = !!task.category
    return (
      <span
        className={`task-cat-chip${own ? '' : ' task-cat-chip--inherited'}${def ? '' : ' task-cat-chip--orphan'}`}
        style={def && own ? { background: def.color } : def ? { color: def.color, borderColor: def.color } : undefined}
        title={own ? 'Category' : 'Inherited from a parent task'}
      >
        {def?.name || id}
      </span>
    )
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

  // Every descendant of any task (getChildrenOf only answers for top-level cards).
  function getDescendantsOf(taskId) {
    const out = []
    const stack = [taskId]
    const seen = new Set()
    while (stack.length) {
      const id = stack.pop()
      for (const t of boardTasks) {
        if (t.parentId === id && !seen.has(t.id)) { seen.add(t.id); out.push(t); stack.push(t.id) }
      }
    }
    return out
  }

  // One renderer for parents and children alike: a child gets the identical card
  // body plus its child markers (indent rail, breadcrumb, sub badge, dimming).
  // `flat` is the swimlane board: hierarchy is already carried by the lane, so a
  // card must not also nest its same-column children underneath itself or every
  // sub-task would be drawn twice.
  function renderTaskCard(task, col, { depth = 0, orphan = false, flat = false, swim = null } = {}) {
    const isChild = depth > 0 || orphan
    const parent = task.parentId ? taskById[task.parentId] : null
    const descendants = getDescendantsOf(task.id)
    const doneDescendants = descendants.filter(c => c.status === 'done').length
    const overdue = isOverdue(task.dueDate)
    // A swimlane card is a drop target even though it renders as a child: the cell
    // is its column, so reordering inside it is the same gesture as reordering a
    // top-level card in the plain board.
    const dropClass = (!isChild || swim) && dragOverCard?.id === task.id ? ` kanban-card--drop-${dragOverCard.pos}` : ''
    const kids = flat ? [] : getChildrenInCol(task.id, col.status)
    const groupClass = [
      'kanban-card-group',
      isChild && !orphan ? 'kanban-card-group--child' : '',
      animatingOut.has(task.id) ? 'kanban-card-group--leaving' : '',
    ].filter(Boolean).join(' ')

    // A swimlane cell is one of seven-plus columns inside one of many lanes, so a
    // card there gets a fraction of the width a column-board card gets. It carries
    // only what the grid cannot already say: which task, how urgent, and which
    // labels it wears. Everything else — assignees, dates, attachments — is one
    // click away in the modal, and on the hover title so nothing is actually lost.
    if (swim) {
      const idLabel = task.number || (task.seq != null ? (taskPrefix ? `${taskPrefix}-${task.seq}` : `#${task.seq}`) : '')
      const swimLabels = (Array.isArray(task.labelIds) ? task.labelIds : []).map(id => labelById[id]).filter(Boolean)
      const hover = [
        task.title,
        swimLabels.length ? `Labels: ${swimLabels.map(l => l.name).join(', ')}` : '',
        task.assignees?.length ? `Assigned: ${task.assignees.join(', ')}` : '',
        task.dueDate ? `${overdue ? 'OVERDUE ' : 'Due '}${formatDate(task.dueDate)}` : '',
        task.priority ? `${PRIORITY_LABEL[task.priority]} priority` : '',
        descendants.length ? `${doneDescendants}/${descendants.length} sub-tasks done` : '',
      ].filter(Boolean).join('\n')
      return (
        <div key={task.id} className={groupClass}>
          <div
            ref={task.id === focusTaskId ? focusCardRef : undefined}
            className={`kanban-card kanban-card--swim${swimLabels.length ? ' kanban-card--swim-labelled' : ''}${draggingId === task.id ? ' kanban-card--dragging' : ''}${dropClass}${task.id === focusTaskId ? ' kanban-card--focused' : ''}`}
            draggable
            role="button"
            tabIndex={0}
            title={hover}
            onClick={() => openEdit(task)}
            onKeyDown={e => { if (e.key === 'Enter') openEdit(task) }}
            onContextMenu={e => handleCardContextMenu(e, task)}
            onDragStart={e => onDragStart(e, task.id)}
            onDragOver={e => onCardDragOver(e, task)}
            onDrop={e => onSwimCardDrop(e, task, col.status, swim)}
            onDragEnd={onDragEnd}
          >
            <div className="kanban-card-swim-top">
              <span className="kanban-card-swim-num">{idLabel}</span>
              {/* A card can be a parent itself — one lane deep is all the board
                  nests, so its own sub-tasks are only visible as this count. */}
              {descendants.length > 0 && (
                <span
                  className={`kanban-card-swim-prog${doneDescendants === descendants.length ? ' kanban-card-swim-prog--all' : ''}`}
                  title={`${doneDescendants} of ${descendants.length} sub-tasks done`}
                >{doneDescendants}/{descendants.length}</span>
              )}
              {task.priority && (
                <span
                  className="kanban-card-swim-dot"
                  style={{ background: PRIORITY_COLOR[task.priority] }}
                />
              )}
            </div>
            <div className="kanban-card-title">{task.title}</div>
            {/* Labels sit below the title, not above it: the title is what you
                scan for, and a row of colour on top of every card would win that
                fight every time. */}
            {swimLabels.length > 0 && (
              <div className="kanban-card-swim-labels">
                {swimLabels.map(l => (
                  <span
                    key={l.id}
                    className="kanban-label-chip kanban-label-chip--mini"
                    style={{ background: l.color }}
                    title={l.name}
                  >{l.name}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      )
    }

    return (
      <div key={task.id} className={groupClass}>
        <div
          ref={task.id === focusTaskId ? focusCardRef : undefined}
          className={`kanban-card${isChild ? ' kanban-card--child' : ''}${draggingId === task.id ? ' kanban-card--dragging' : ''}${dropClass}${task.id === focusTaskId ? ' kanban-card--focused' : ''}`}
          draggable
          role="button"
          tabIndex={0}
          onClick={() => openEdit(task)}
          onKeyDown={e => { if (e.key === 'Enter') openEdit(task) }}
          onContextMenu={e => handleCardContextMenu(e, task)}
          onDragStart={e => onDragStart(e, task.id)}
          onDragOver={isChild ? undefined : e => onCardDragOver(e, task)}
          onDrop={isChild ? undefined : e => onCardDrop(e, task, col.status)}
          onDragEnd={onDragEnd}
        >
          {isChild && parent && (
            <div
              className="kanban-card-parent-crumb"
              role="button"
              tabIndex={0}
              title={`Parent: ${parent.title}`}
              onClick={e => { e.stopPropagation(); openEdit(parent) }}
              onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); openEdit(parent) } }}
            >
              <span className="kanban-card-parent-crumb-arrow">↳</span>
              {parent.number && <span className="task-number" style={{ fontSize: 9 }}>{parent.number}</span>}
              <span className="kanban-card-parent-crumb-title">{parent.title}</span>
            </div>
          )}
          {/* An <img>, not a CSS background: a background-image cannot be lazy-loaded,
              so a column of cards would fetch every cover at once whether or not any
              of them was ever scrolled into view. */}
          {coverSrc(task) && (
            <img src={coverSrc(task)} alt="" className="kanban-card-cover" loading="lazy" decoding="async" />
          )}
          {renderCardLabels(task)}
          <div className="kanban-card-header">
            {renderCardCategory(task)}
            {isChild && <span className="kanban-sub-badge" title="Sub-task">↳ sub</span>}
            {(task.seq != null || task.number) && <span className="task-id-badge" style={{ fontSize: 10 }}>{task.seq != null ? (taskPrefix ? `${taskPrefix}-${task.seq}` : `#${task.seq}`) : `#${task.number}`}</span>}
            {task.number && <span className="task-number" style={{ fontSize: 10 }}>{task.number}</span>}
            <button
              className="kanban-card-edit-btn"
              onClick={e => openUpdates(e, task)}
              title="Updates"
            >💬</button>
            <button
              className="kanban-card-edit-btn"
              onClick={e => copyCardLink(e, task)}
              title="Copy link to this task"
            >{copiedId === task.id ? '✓' : '🔗'}</button>
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
            {descendants.length > 0 && (
              <span className="task-meta-chip kanban-progress-chip">
                {doneDescendants}/{descendants.length} sub
              </span>
            )}
            {task.updates?.length > 0 && (
              <span
                className="task-meta-chip task-updates-badge"
                role="button"
                tabIndex={0}
                title={`${task.updates.length} update(s) — click to open`}
                onClick={e => openUpdates(e, task)}
                onKeyDown={e => { if (e.key === 'Enter') openUpdates(e, task) }}
              >💬 {task.updates.length}</span>
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

        {kids.length > 0 && (
          <div className="kanban-child-cards">
            {kids.map(kid => renderTaskCard(kid, col, { depth: depth + 1 }))}
          </div>
        )}

        {canEditAll && (
          <button
            className="kanban-add-subtask-btn kanban-add-subtask-btn--card"
            onClick={() => openSubAdd(task)}
          >+ sub-task</button>
        )}
      </div>
    )
  }

  // Built once here rather than inside renderSwimBoard: the toolbar's Expand all
  // needs the same lane list the board renders, and walking every task twice a
  // render to get it is a waste on a large board.
  const swimBoardData = layout === 'swimlanes' ? swimLanes() : null
  const swimLaneIdList = swimBoardData
    ? [
      ...swimBoardData.lanes.map(l => l.root.id),
      ...(swimBoardData.loose.length ? [LOOSE_LANE] : []),
    ]
    : []
  const allLanesExpanded = swimLaneIdList.length > 0
    && swimLaneIdList.every(id => expandedLanes.has(id))
  const allLanesCollapsed = swimLaneIdList.length > 0
    && swimLaneIdList.every(id => collapsedLanes.has(id))

  return (
    <div>
      <div className="kanban-filter-bar">
        <div className="search-bar" style={{ flex: 1, minWidth: 160 }}>
          <input
            className="form-input search-input"
            placeholder="Search tasks or people…"
            value={kbSearch}
            onChange={e => setKbSearch(e.target.value)}
          />
          {kbSearch && (
            <button className="btn-ghost search-clear" onClick={() => setKbSearch('')} title="Clear">&#x2715;</button>
          )}
        </div>
        <FilterMultiSelect
          label="Status"
          options={columns.map(c => ({ value: c.status, label: c.label }))}
          selected={kbStatuses}
          onToggle={toggleKbStatus}
          onClear={() => setKbStatuses([])}
        />
        <FilterMultiSelect
          label="Priority"
          options={PRIORITY_ORDER.map(p => ({ value: p, label: p.charAt(0).toUpperCase() + p.slice(1) }))}
          selected={kbPriorities}
          onToggle={toggleKbPriority}
          onClear={() => setKbPriorities([])}
        />
        <div className="tt-date-filter" title="Filter by start date">
          <span className="tt-date-filter-label">Start</span>
          <input type="date" className="form-input tt-date-input" value={kbStartFrom} onChange={e => setKbStartFrom(e.target.value)} title="Start date from" />
          <span className="tt-date-filter-sep">–</span>
          <input type="date" className="form-input tt-date-input" value={kbStartTo} onChange={e => setKbStartTo(e.target.value)} title="Start date to" />
        </div>
        <div className="tt-date-filter" title="Filter by due date">
          <span className="tt-date-filter-label">Due</span>
          <input type="date" className="form-input tt-date-input" value={kbDueFrom} onChange={e => setKbDueFrom(e.target.value)} title="Due date from" />
          <span className="tt-date-filter-sep">–</span>
          <input type="date" className="form-input tt-date-input" value={kbDueTo} onChange={e => setKbDueTo(e.target.value)} title="Due date to" />
        </div>
        {availableDueDates.length > 0 && (
          <DatePicker
            label="Due dates"
            dates={availableDueDates}
            selected={kbDueDates}
            onToggle={toggleKbDueDate}
            onClear={() => setKbDueDates([])}
            format={formatIsoDate}
          />
        )}
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
        <button
          className="btn-ghost"
          style={{ whiteSpace: 'nowrap', fontSize: 12 }}
          onClick={copyAllLinks}
          title="Copy a shareable link for every card shown"
        >
          {copiedAll ? `✓ Copied ${copiedAll}` : '🔗 Copy links'}
        </button>
        {categories.length > 0 && (
          <FilterMultiSelect
            label="Category"
            options={[...categories.map(c => ({ value: c.id, label: c.name })), { value: '', label: 'Uncategorised' }]}
            selected={kbCategories}
            onToggle={toggleKbCategory}
            onClear={() => setKbCategories([])}
          />
        )}
        {/* The board's three axes. Only the first is a real choice today —
            "None" is the plain column board. The other two are fixed selects
            rather than labels so the shape of the board is legible at a glance,
            and so swapping a sub-lane for Assignee or Sprint later is a new
            option rather than new chrome. */}
        <div className="swim-axes" role="group" aria-label="Board axes">
          <span className="swim-axes-label">Lanes</span>
          <select
            className="swim-axis-select"
            value={layout === 'swimlanes' ? 'story' : ''}
            onChange={e => chooseLayout(e.target.value === 'story' ? 'swimlanes' : 'columns')}
            title="One lane per story, or no lanes at all"
          >
            <option value="story">Story</option>
            <option value="">None</option>
          </select>
          <span className="swim-axes-label">Sub-lanes</span>
          <select
            className="swim-axis-select"
            value={subLane}
            disabled={layout !== 'swimlanes'}
            onChange={e => chooseSubLane(e.target.value)}
            title="Split each lane into category rails, or give it one row of statuses"
          >
            <option value="category">Category</option>
            <option value="none">None</option>
          </select>
          <span className="swim-axes-label">Columns</span>
          <select
            className="swim-axis-select"
            defaultValue="status"
            disabled
            title="Columns are board statuses"
          >
            <option value="status">Status</option>
          </select>
        </div>
        {/* Two different "all"s, so they are labelled by what they act on: one
            hides the tasks under every story, the other decides whether the
            tasks that *are* shown sit behind a "+N more" chip. */}
        {layout === 'swimlanes' && (
          <div className="swim-bulk" role="group" aria-label="Expand and collapse">
            <button
              className="btn-ghost swim-expand-all"
              onClick={() => setAllLanesCollapsed(!allLanesCollapsed, swimLaneIdList)}
              disabled={!swimLaneIdList.length}
              aria-pressed={allLanesCollapsed}
              title={allLanesCollapsed
                ? 'Show the tasks under every story again'
                : 'Hide the tasks under every story — stories only'}
            >
              {allLanesCollapsed ? '⌄ Expand all stories' : '⌃ Collapse all stories'}
            </button>
            <button
              className="btn-ghost swim-expand-all"
              onClick={() => setAllLanesExpanded(!allLanesExpanded, swimLaneIdList)}
              disabled={!swimLaneIdList.length}
              aria-pressed={allLanesExpanded}
              title={allLanesExpanded
                ? 'Cap every cell again and bring back the “+N more” chips'
                : 'Show every task in every story — no “+N more” chips'}
            >
              {allLanesExpanded ? '⤡ Collapse all tasks' : '⤢ Expand all tasks'}
            </button>
          </div>
        )}
        {labelsApi && (
          <button className="btn-ghost" style={{ whiteSpace: 'nowrap', fontSize: 12 }} onClick={() => setShowLabelMgr(true)}>
            🏷 Labels
          </button>
        )}
        {slug && (
          <button
            className="btn-ghost"
            style={{ whiteSpace: 'nowrap', fontSize: 12 }}
            onClick={() => setShowCatMgr(true)}
            title="Categories group work within a story (Frontend, Backend, UI/UX…)"
          >
            🗂 Categories{categories.length ? ` (${categories.length})` : ''}
          </button>
        )}
        {canEditAll && slug && (
          <button className="btn-ghost" style={{ whiteSpace: 'nowrap', fontSize: 12 }} onClick={openAclMgr} title="Task id prefix & assignee permissions">
            ⚙ Task Settings
          </button>
        )}
        {hasKbFilters && (
          <button className="btn-ghost" style={{ whiteSpace: 'nowrap', fontSize: 12 }} onClick={clearKbFilters}>
            Clear filters
          </button>
        )}
      </div>
      {colError && <div className="kanban-col-error">{colError}</div>}
      {layout === 'swimlanes' ? renderSwimBoard(swimBoardData) : (
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
                  draggable={canEditColumns}
                  onDragStart={e => onColDragStart(e, col.status)}
                  onDragEnd={onDragEnd}
                  title={canEditColumns ? 'Drag to reorder column (applies to everyone)' : undefined}
                >
                  <div className="kanban-column-title">
                    {canEditColumns && <span className="kanban-col-drag-handle">⠿</span>}
                    <span
                      className="kanban-column-dot"
                      style={{ background: col.color, ...(canEditColumns ? { cursor: 'pointer' } : {}) }}
                      title={canEditColumns ? 'Change color' : undefined}
                      onClick={e => {
                        if (!canEditColumns) return
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
                        title={canEditColumns ? 'Click to rename' : undefined}
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
                      {canEditColumns && (
                        <button
                          className="kanban-col-delete-btn"
                          onMouseDown={e => e.stopPropagation()}
                          onClick={() => deleteColumn(col.status)}
                          title="Delete column"
                        >✕</button>
                      )}
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
                      <SubmitButton
                        className="btn-primary"
                        style={{ fontSize: 12, padding: '4px 10px' }}
                        busyLabel="Adding…"
                        onClick={saveNew}
                        disabled={!addForm.title.trim() || !labelsOk(addForm.labelIds)}
                      >Add</SubmitButton>
                    </div>
                    {labels.length > 0 && (
                      <div className="kanban-add-labels">
                        {labels.map(l => {
                          const on = (addForm.labelIds || []).includes(l.id)
                          return (
                            <button
                              key={l.id}
                              type="button"
                              className="kanban-label-chip kanban-label-chip--toggle"
                              style={{ background: on ? l.color : 'transparent', color: on ? '#fff' : l.color, borderColor: l.color }}
                              onClick={() => toggleAddLabel(l.id)}
                            >{on ? '✓ ' : ''}{l.name}</button>
                          )
                        })}
                      </div>
                    )}
                    {renderLabelHint(addForm.labelIds)}
                    {renderSubFormChildren(addForm.children || [], [])}
                    <button
                      className="kanban-add-subtask-btn"
                      onClick={() => setAddForm(f => ({ ...f, children: [...(f.children || []), { _lid: Date.now() + Math.random(), title: '', priority: 'medium', children: [] }] }))}
                    >+ Add subtask</button>
                  </div>
                )}

                <div className="kanban-cards">
                  {colTasks.map(task => renderTaskCard(task, col))}

                  {getOrphanSubsInCol(col.status).map(sub => renderTaskCard(sub, col, { orphan: true }))}

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
                      {/* Selection survives each Add, so a run of cards in the same
                          discipline is one pick and N titles. */}
                      {labels.length > 0 && (
                        <div className="kanban-add-labels">
                          {labels.map(l => {
                            const on = quickAddLabels.includes(l.id)
                            return (
                              <button
                                key={l.id}
                                type="button"
                                className="kanban-label-chip kanban-label-chip--toggle"
                                style={{ background: on ? l.color : 'transparent', color: on ? '#fff' : l.color, borderColor: l.color }}
                                onClick={() => toggleQuickLabel(l.id)}
                              >{on ? '✓ ' : ''}{l.name}</button>
                            )
                          })}
                        </div>
                      )}
                      {renderLabelHint(quickAddLabels)}
                      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                        <button className="btn-primary" style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => quickAdd(col.status)} disabled={!quickAddTitle.trim() || !labelsOk(quickAddLabels)}>Add card</button>
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
          ) : canEditColumns ? (
            <button className="kanban-add-col-btn" onClick={() => setAddingCol(true)}>
              + Add column
            </button>
          ) : null}
        </div>
      </div>
      )}

      {showCatMgr && (
        <CategoryManager
          slug={slug}
          categories={savedCategories}
          tasks={tasks.filter(t => !t.archived)}
          currentUser={currentUser}
          onClose={() => setShowCatMgr(false)}
        />
      )}

      {cellPeek && renderCellPeek()}

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
                <SubmitButton className="btn-primary" onClick={saveAcl}>Save</SubmitButton>
              </div>
            </div>
          </div>
        </div>
      )}

      {subAddFor && taskById[subAddFor] && (() => {
        const parent = taskById[subAddFor]
        return (
          <div
            className="kanban-modal-overlay"
            onClick={e => { if (e.target === e.currentTarget) closeSubAdd() }}
            onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); closeSubAdd() } }}
          >
            <div className="kanban-modal">
              <div className="kanban-modal-header">
                <span>Add Sub-task</span>
                <button className="kanban-modal-close" onClick={closeSubAdd}>✕</button>
              </div>
              <div className="task-form">
                <div className="kanban-sub-parent">
                  <span className="kanban-subtask-indent-arrow" aria-hidden="true">↳</span>
                  under <strong>{parent.title}</strong>
                  {taskLabel(parent) && <span className="kanban-sub-parent-id">{taskLabel(parent)}</span>}
                </div>
                <input
                  ref={subTitleRef}
                  className="form-input"
                  placeholder="Title *"
                  value={subAddForm.title}
                  autoFocus
                  onChange={e => setSubAddForm(p => ({ ...p, title: e.target.value }))}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.nativeEvent?.isComposing) { e.preventDefault(); addSubtask(parent) }
                  }}
                />
                <AutoTextarea
                  className="form-input task-desc-input"
                  placeholder="Description (optional)"
                  value={subAddForm.description}
                  onChange={e => setSubAddForm(p => ({ ...p, description: e.target.value }))}
                />

                {labels.length > 0 && (
                  <div className="task-assignees-selector">
                    <span className="task-assignees-label">Labels:</span>
                    <div className="task-assignees-list">
                      {labels.map(l => {
                        const on = subAddForm.labelIds.includes(l.id)
                        return (
                          <button
                            key={l.id}
                            type="button"
                            className="kanban-label-chip kanban-label-chip--toggle"
                            style={{ background: on ? l.color : 'transparent', color: on ? '#fff' : l.color, borderColor: l.color }}
                            onClick={() => toggleSubLabel(l.id)}
                          >{on ? '✓ ' : ''}{l.name}</button>
                        )
                      })}
                    </div>
                  </div>
                )}
                {renderLabelHint(subAddForm.labelIds)}

                <div className="task-form-row">
                  <select className="form-input" value={subAddForm.status} onChange={e => setSubAddForm(p => ({ ...p, status: e.target.value }))}>
                    {columns.map(c => <option key={c.status} value={c.status}>{c.label}</option>)}
                  </select>
                  <select className="form-input" value={subAddForm.priority} onChange={e => setSubAddForm(p => ({ ...p, priority: e.target.value }))}>
                    <option value="low">Low priority</option>
                    <option value="medium">Medium priority</option>
                    <option value="high">High priority</option>
                    <option value="critical">Critical priority</option>
                  </select>
                </div>
                <AssigneeInput
                  value={subAddForm.assignees}
                  options={assignees}
                  onChange={next => setSubAddForm(p => ({ ...p, assignees: next }))}
                />
                <div className="task-form-row">
                  <input className="form-input" type="date" title="Start date" value={subAddForm.startDate} onChange={e => setSubAddForm(p => ({ ...p, startDate: e.target.value }))} />
                  <input className="form-input" type="date" title="Due date" value={subAddForm.dueDate} onChange={e => setSubAddForm(p => ({ ...p, dueDate: e.target.value }))} />
                </div>

                <div className="kanban-sub-modal-actions">
                  <label className="kanban-sub-another" title="Keep this dialog open after adding">
                    <input type="checkbox" checked={subAddAnother} onChange={e => setSubAddAnother(e.target.checked)} />
                    Add another
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn-ghost" onClick={closeSubAdd}>Cancel</button>
                    <SubmitButton
                      className="btn-primary"
                      onClick={() => addSubtask(parent)}
                      disabled={!subAddForm.title.trim() || !labelsOk(subAddForm.labelIds)}
                      busyLabel="Adding…"
                    >Add Sub-task</SubmitButton>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {updatesFor && taskById[updatesFor] && (() => {
        const task = taskById[updatesFor]
        const list = Array.isArray(task.updates) ? task.updates : []
        const close = () => { setUpdatesFor(null); setUpdateText('') }
        return (
          <div
            className="kanban-modal-overlay"
            onClick={e => { if (e.target === e.currentTarget) close() }}
            onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); close() } }}
          >
            <div className="kanban-modal">
              <div className="kanban-modal-header">
                <div className="kanban-modal-title">
                  {taskLabel(task) && <span className="task-id-badge" style={{ fontSize: 10 }}>{taskLabel(task)}</span>}
                  <span className="kanban-modal-title-text">{task.title}</span>
                </div>
                <button className="kanban-modal-close" onClick={close}>✕</button>
              </div>
              <div className="task-updates-panel">
                <div className="task-updates-list">
                  {list.length === 0 ? (
                    <div className="task-updates-empty">No updates yet.</div>
                  ) : (
                    [...list].reverse().map(u => (
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
                  <MentionInput
                    className="form-input"
                    placeholder="Add an update… use @name to mention"
                    value={updateText}
                    autoFocus
                    people={assignees}
                    onChange={setUpdateText}
                    onSubmit={() => postUpdate(task)}
                    style={{ flex: 1, fontSize: 12 }}
                  />
                  <SubmitButton
                    className="btn-primary"
                    onClick={() => postUpdate(task)}
                    disabled={!updateText.trim()}
                    busyLabel="Posting…"
                    style={{ fontSize: 12, padding: '5px 12px', whiteSpace: 'nowrap' }}
                  >Post</SubmitButton>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {editingTask && editForm && (
        <div
          className="kanban-modal-overlay"
          onClick={e => { if (e.target === e.currentTarget) closeEdit() }}
        >
          <div className="kanban-modal">
            <div className="kanban-modal-header">
              <div className="kanban-modal-nav">
                {editStack.length > 0 && (
                  <button className="kanban-modal-back" onClick={backEdit} title="Back">←</button>
                )}
                {(() => {
                  const chain = ancestorChain(editingTask)
                  // Deep chains collapse the middle: root › … › parent.
                  const shown = chain.length > 3 ? [chain[0], null, ...chain.slice(-2)] : chain
                  const hidden = chain.length > 3 ? chain.slice(1, -2) : []
                  return (
                    <div className="kanban-modal-title-block">
                      {chain.length > 0 && (
                        <nav className="kanban-modal-crumbs" aria-label="Task ancestors">
                          {shown.map((a, i) => [
                            i > 0 && <span key={`s${i}`} className="kanban-modal-crumb-sep" aria-hidden="true">›</span>,
                            a ? (
                              <button
                                key={a.id}
                                className="kanban-modal-crumb"
                                onClick={() => navEdit(a)}
                                title={`Open ${taskLabel(a)} ${a.title}`.trim()}
                              >
                                {taskLabel(a) && <span className="kanban-modal-crumb-id">{taskLabel(a)}</span>}
                                <span className="kanban-modal-crumb-title">{a.title}</span>
                              </button>
                            ) : (
                              <span key={`gap${i}`} className="kanban-modal-crumb-ellipsis" title={hidden.map(h => h.title).join(' › ')}>…</span>
                            ),
                          ])}
                        </nav>
                      )}
                      <div className="kanban-modal-title">
                        {chain.length > 0 && <span className="kanban-modal-title-arrow" aria-hidden="true">↳</span>}
                        {taskLabel(editingTask) && <span className="task-id-badge" style={{ fontSize: 10 }}>{taskLabel(editingTask)}</span>}
                        <span className="kanban-modal-title-text">{chain.length ? editingTask.title : 'Edit Task'}</span>
                      </div>
                    </div>
                  )
                })()}
              </div>
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
              <AutoTextarea
                className="form-input task-desc-input"
                placeholder="Description (optional)"
                value={editForm.description}
                onChange={e => setEditForm(p => ({ ...p, description: e.target.value }))}
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
                {categories.length > 0 && (() => {
                  // Blank means "inherit from the nearest ancestor", not "none" —
                  // say which one, or the empty option reads as clearing the value.
                  const parent = editingTask.parentId ? catTaskIndex[editingTask.parentId] : null
                  const inherited = parent ? catOf(parent) : ''
                  // A story lane spans every rail beneath it, so a category on the
                  // story contradicts its own children — and because categories
                  // inherit, it would sweep every uncategorised descendant into one
                  // rail in a single edit. Don't offer the field on a lane. A lane
                  // that already carries one from an earlier edit keeps the select,
                  // so the value can still be cleared.
                  const isLane = !editingTask.parentId && getDescendantsOf(editingTask.id).length > 0
                  if (isLane && !editForm.category) {
                    return (
                      <span className="task-form-hint">
                        Stories have no category — set it on the tasks beneath.
                      </span>
                    )
                  }
                  return (
                    <select
                      className="form-input"
                      value={editForm.category || ''}
                      onChange={e => setEditForm(p => ({ ...p, category: e.target.value }))}
                      title="Category"
                    >
                      <option value="">
                        {inherited ? `Inherit — ${catById[inherited]?.name || inherited}` : 'No category'}
                      </option>
                      {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  )
                })()}
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

              {/* Sub-tasks: click through to edit one */}
              {(() => {
                const kids = directChildren(editingTask.id)
                if (!kids.length) return null
                const doneCount = kids.filter(k => k.status === 'done').length
                return (
                  <div className="kanban-subtask-section">
                    <div className="task-assignees-label" style={{ marginBottom: 6 }}>
                      Sub-tasks <span className="kanban-subtask-count">{doneCount}/{kids.length}</span>
                    </div>
                    <div className="kanban-subtask-list">
                      {kids.map(child => {
                        const done = child.status === 'done'
                        return (
                          <div key={child.id} className={`kanban-subtask-row${done ? ' kanban-subtask-row--done' : ''}`}>
                            <button
                              type="button"
                              className="kanban-subtask-open"
                              onClick={() => navEdit(child)}
                              title={`Open ${child.title}`}
                            >
                              {taskLabel(child) && <span className="task-id-badge" style={{ fontSize: 9 }}>{taskLabel(child)}</span>}
                              <span className="kanban-subtask-title">{child.title}</span>
                              <span className="kanban-subtask-chevron" aria-hidden="true">›</span>
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}

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
                            ? <a href={attSrc(att)} target="_blank" rel="noopener noreferrer" title="View"><img src={attSrc(att)} alt={att.name} className="kanban-attach-thumb" loading="lazy" decoding="async" /></a>
                            : <span className="kanban-attach-file">📄</span>}
                          <a href={attSrc(att)} target="_blank" rel="noopener noreferrer" className="kanban-attach-name" title={att.name}>{att.name}</a>
                          <a href={attSrc(att)} target="_blank" rel="noopener noreferrer" className="btn-ghost" style={{ fontSize: 11 }} title="View">View</a>
                          <a href={attSrc(att)} download={att.name} className="btn-ghost" style={{ fontSize: 11 }} title="Download">Download</a>
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
                  <MentionInput
                    className="form-input"
                    placeholder="Comment… use @name to mention"
                    value={commentText}
                    people={assignees}
                    onChange={setCommentText}
                    onSubmit={postComment}
                    style={{ flex: 1, fontSize: 12 }}
                  />
                  <button className="btn-primary" onClick={postComment} disabled={!commentText.trim()} style={{ fontSize: 12, padding: '5px 12px', whiteSpace: 'nowrap' }}>Post</button>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                <SubmitButton className="btn-ghost" style={{ color: '#dc2626' }} busyLabel="Archiving…" onClick={archiveTask} title="Archive this card">Archive</SubmitButton>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-ghost" onClick={closeEdit}>Cancel</button>
                  <SubmitButton
                    className="btn-primary"
                    onClick={saveEdit}
                    disabled={!editForm.title.trim()}
                  >Save</SubmitButton>
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
