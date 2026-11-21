// Sub-tasks have three states; only stories (root tasks) travel the board's columns.
//
//   Not started (todo) → In progress (in-progress) → Done (done)
//
// A sub-task is shown under its story, never dragged on its own. Its status is set
// from that row (or its card), and a story moved to Done closes the open ones
// (lib/task-cascade.js).
//
// Sub-tasks saved before this rule may hold any column status (backlog, in-review,
// blocked…). Those are never rewritten on read; `subtaskStatus()` says which of the
// three they count as, and only a NEW status written to a sub-task has to be one of
// the three (lib/task-store.js).
const SUBTASK_STATUSES = [
  { status: 'todo', label: 'Not started' },
  { status: 'in-progress', label: 'In progress' },
  { status: 'done', label: 'Done' },
]
const SUBTASK_STATUS_SET = new Set(SUBTASK_STATUSES.map(s => s.status))

function isSubtaskStatus(s) {
  return SUBTASK_STATUS_SET.has(s)
}

// Which of the three a stored status counts as.
function subtaskStatus(s) {
  if (s === 'done') return 'done'
  if (!s || s === 'todo' || s === 'backlog') return 'todo'
  return 'in-progress'
}

function subtaskStatusLabel(s) {
  return SUBTASK_STATUSES.find(x => x.status === subtaskStatus(s)).label
}

// The status choices for a task's status picker: every board column for a story, the
// three states for a sub-task — plus, for an old sub-task still holding a column status,
// that status (marked) so opening and saving the card does not change it.
function statusOptions(columns, task) {
  if (!task || !task.parentId) return (columns || []).map(c => ({ status: c.status, label: c.label }))
  const out = SUBTASK_STATUSES.slice()
  if (task.status && !isSubtaskStatus(task.status)) {
    const col = (columns || []).find(c => c.status === task.status)
    out.unshift({ status: task.status, label: `${col ? col.label : task.status} (old)` })
  }
  return out
}

// The three states as board columns, borrowing each one's colour from the project's
// column of the same status when there is one.
function subtaskColumns(columns) {
  const FALLBACK = { todo: '#3b82f6', 'in-progress': '#f59e0b', done: '#22c55e' }
  return SUBTASK_STATUSES.map(s => {
    const col = (columns || []).find(c => c.status === s.status)
    return { status: s.status, label: s.label, color: col?.color || FALLBACK[s.status] }
  })
}

module.exports = { SUBTASK_STATUSES, isSubtaskStatus, subtaskStatus, subtaskStatusLabel, statusOptions, subtaskColumns }
