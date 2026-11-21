// What a parent's status change does to the tasks under it. One rule, shared by the
// server (applied inside the task-list lock) and the boards (shown optimistically):
//
//   parent → done        every unfinished descendant is done too — a story cannot be
//                        finished while its sub-tasks are still open
//   parent → any other   sub-tasks keep their own status: they have only Not started /
//                        In progress / Done (lib/subtask-status.js), set per sub-task
//
// Finished work is never reopened: a done sub-task stays done whatever the parent
// does. Archived tasks are left alone.

// `tasks` is one flat list (one version). Returns { [taskId]: newStatus } for the
// descendants that change — the parent itself is not included.
function cascadeStatus(tasks, parentId, fromStatus, toStatus) {
  const out = {}
  if (!parentId || !toStatus || fromStatus === toStatus) return out
  const childrenOf = {}
  for (const t of tasks || []) {
    if (t && t.parentId) (childrenOf[t.parentId] = childrenOf[t.parentId] || []).push(t)
  }
  const stack = [...(childrenOf[parentId] || [])]
  const seen = new Set([parentId])
  while (stack.length) {
    const t = stack.pop()
    if (!t || seen.has(t.id)) continue
    seen.add(t.id)
    stack.push(...(childrenOf[t.id] || []))
    if (t.archived || t.status === 'done') continue
    if (toStatus === 'done') out[t.id] = 'done'
  }
  return out
}

function hasChildren(tasks, id) {
  return (tasks || []).some(t => t && t.parentId === id)
}

// The optimistic entry for a status write: the task's own patch, plus its sub-tasks
// when `cascade` (the caller may edit tasks — the server applies the same rule only
// then). `tasks` must be the task's own version list.
function statusOptimistic(tasks, task, patch, scope, cascade) {
  const moves = cascade && 'status' in patch ? cascadeStatus(tasks, task.id, task.status, patch.status) : {}
  const ids = Object.keys(moves)
  if (!ids.length) return { entity: 'task', op: 'update', scope, id: task.id, patch }
  const patches = { [task.id]: patch }
  for (const id of ids) patches[id] = { status: moves[id] }
  return { entity: 'task', op: 'updateMany', scope, patches }
}

module.exports = { cascadeStatus, hasChildren, statusOptimistic }
