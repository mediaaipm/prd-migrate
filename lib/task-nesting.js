// Nesting floor for regular users.
//
// A main task (`parentId === null`) sits at depth 0, its sub-task at depth 1, a
// sub-sub-task at depth 2. A regular user who holds task:create may only put a task
// at depth 2 or deeper: no main tasks, no sub-tasks. Shaping the tree — the stories
// and the sub-tasks under them — belongs to admins and superadmins; a user fills in
// the work beneath it.
//
// Enforced here, in every route that can set a task's parentId, because that is the
// only place it can be enforced. The clients hide the buttons (TaskTree,
// KanbanBoard, CalendarView) but the write queue replays raw POST/PUT/PATCH bodies,
// so a hidden button proves nothing.
const { getSessionUser } = require('./session');
const { listTasks } = require('./task-store');

// Shallowest depth a capped account may create at, or move a task to.
const MIN_ADMIN_DEPTH = 2;

const CREATE_ERROR = 'Only an admin can add main tasks and sub-tasks. Pick a sub-task as the parent — a regular user builds at sub-sub-task level and below.';
const MOVE_ERROR = 'Only an admin can move a task up to main-task or sub-task level. It has to stay under a sub-task.';

// Identity comes from the signed session cookie only — same rule as
// lib/require-permission.js. Admin and superadmin shape the tree freely; everyone
// else is capped. A legacy superadmin session carries isAdmin with no role. An
// unsigned request has no session at all, so it caps too — those are refused
// upstream regardless.
function isNestingCapped(req) {
  const user = getSessionUser(req) || {};
  if (user.role === 'superadmin' || user.role === 'admin') return false;
  if (user.isAdmin === true && !user.role) return false;
  return true;
}

// How deep `taskId` sits in the flat list. -1 when it is not there. Cycle-safe: a
// corrupted parent chain stops rather than spinning.
function taskDepth(tasks, taskId) {
  const byId = new Map((tasks || []).map(t => [t.id, t]));
  let cur = byId.get(taskId);
  if (!cur) return -1;
  let depth = 0;
  const seen = new Set([taskId]);
  while (cur.parentId && byId.has(cur.parentId) && !seen.has(cur.parentId)) {
    seen.add(cur.parentId);
    cur = byId.get(cur.parentId);
    depth++;
  }
  return depth;
}

// Depth a task would land at under `parentId` (null => a root task, depth 0). An id
// that is not in the list counts as no parent, which is what createTask/moveTask do
// with it — the task ends up at the root.
function depthUnder(tasks, parentId) {
  if (!parentId) return 0;
  const d = taskDepth(tasks, parentId);
  return d < 0 ? 0 : d + 1;
}

// The PATCH `move` action names a target and a position, not a parent. Resolve the
// parent exactly the way moveTask does in lib/task-store.js, so the guard checks the
// move that will actually happen. `undefined` when the target is gone — moveTask
// no-ops on that, so there is nothing to block.
function moveParentId(tasks, targetId, position) {
  const target = (tasks || []).find(t => t.id === targetId);
  if (!target) return undefined;
  return position === 'child' ? target.id : (target.parentId || null);
}

// Gate for the create routes. Sends the 403 itself and returns false when the new
// task would land above the floor.
async function allowCreateUnder(req, res, slug, version, parentId) {
  if (!isNestingCapped(req)) return true;
  const tasks = await listTasks(slug, version || null);
  if (depthUnder(tasks, parentId) >= MIN_ADMIN_DEPTH) return true;
  res.status(403).json({ error: CREATE_ERROR });
  return false;
}

// Gate for every write that can re-parent existing tasks. `changes` is a list of
// `{ id, parentId }` the request wants to apply. A pure reorder — the parent the
// task already has — always passes; only an actual change of parent has to clear
// the floor, so reordering main tasks among themselves still works.
async function allowReparent(req, res, slug, version, changes) {
  if (!isNestingCapped(req)) return true;
  const tasks = await listTasks(slug, version || null);
  const byId = new Map(tasks.map(t => [t.id, t]));
  for (const c of (changes || [])) {
    if (!c || c.parentId === undefined) continue;
    const cur = byId.get(c.id);
    if (!cur) continue;
    const next = c.parentId || null;
    if ((cur.parentId || null) === next) continue;
    if (depthUnder(tasks, next) < MIN_ADMIN_DEPTH) {
      res.status(403).json({ error: MOVE_ERROR });
      return false;
    }
  }
  return true;
}

module.exports = {
  MIN_ADMIN_DEPTH,
  CREATE_ERROR,
  MOVE_ERROR,
  isNestingCapped,
  taskDepth,
  depthUnder,
  moveParentId,
  allowCreateUnder,
  allowReparent,
};
