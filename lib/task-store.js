const { Redis } = require('@upstash/redis');
let _kv;
function getKv() { if (!_kv) _kv = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN, enableAutoPipelining: true }); return _kv; }

function tasksKey(slug, version) {
  return version ? `tasks:${slug}:${version}` : `tasks:${slug}:__root`;
}

// Thrown when an admin-supplied task id (`seq`) is invalid or already taken.
// API handlers map this to a 409 instead of a 500.
class TaskIdError extends Error {
  constructor(message) { super(message); this.code = 'TASK_ID'; }
}

// Every redis list that holds tasks for a project (root list + one per version).
async function taskListKeys(slug) {
  const versions = (await getKv().smembers(`versions:${slug}`)) || [];
  const keys = versions.map(v => `tasks:${slug}:${v}`);
  keys.push(tasksKey(slug, null));
  return keys;
}

// All display-id numbers currently in use across every version of the project.
// `excludeId` skips one task (used so editing a task doesn't collide with itself).
async function projectSeqs(slug, { excludeId } = {}) {
  const keys = await taskListKeys(slug);
  const lists = await getKv().mget(...keys);
  const seqs = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const t of list) {
      if (excludeId && t.id === excludeId) continue;
      const n = Number(t.seq);
      if (Number.isFinite(n)) seqs.push(n);
    }
  }
  return seqs;
}

// The project's configured starting id number (admin-set, default 1).
async function seqStart(slug) {
  const meta = await getKv().get(`project:${slug}`);
  const n = meta && Number(meta.taskSeqStart);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

// Next display-id number, allocated with a single atomic INCR. Ids are never reused.
//
// The old implementation recomputed the max by loading every task in every version on
// each create, which is what made task creation slow enough to be felt. The counter is
// now authoritative; the scan runs at most once per project, to seed it.
async function nextSeq(slug) {
  const kv = getKv();
  const key = `taskseq:${slug}`;
  const [n, start] = await Promise.all([kv.incr(key), seqStart(slug)]);

  // n === 1 means the counter did not exist. Either the project is new, or it predates
  // the counter and already has tasks — seed from the highest seq in use so we never
  // hand out a number twice.
  if (n === 1) {
    const seqs = await projectSeqs(slug);
    const floor = Math.max(start - 1, seqs.length ? Math.max(...seqs) : 0);
    if (floor >= 1) {
      const seeded = floor + 1;
      await kv.set(key, seeded);
      return seeded;
    }
    return Math.max(n, start);
  }

  // An admin raised the project's starting number after tasks already existed.
  if (n < start) {
    await kv.set(key, start);
    return start;
  }
  return n;
}

function computeNumbers(tasks) {
  const byId = {};
  const roots = [];
  tasks.forEach(t => { byId[t.id] = { ...t, _children: [] }; });
  tasks.forEach(t => {
    if (t.parentId && byId[t.parentId]) byId[t.parentId]._children.push(byId[t.id]);
    else roots.push(byId[t.id]);
  });

  function sortNodes(nodes) {
    nodes.sort((a, b) => a.order - b.order);
    nodes.forEach(n => sortNodes(n._children));
  }
  sortNodes(roots);

  function assign(nodes, prefix) {
    nodes.forEach((node, i) => {
      const auto = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
      node.number = node.numberOverride || auto;
      node.autoNumber = auto;
      assign(node._children, auto);
    });
  }
  assign(roots, '');

  return tasks.map(t => {
    const n = byId[t.id];
    return { ...t, number: n.number, autoNumber: n.autoNumber };
  });
}

async function loadTasks(slug, version) {
  const data = await getKv().get(tasksKey(slug, version));
  return data || [];
}

async function saveTasks(slug, version, tasks) {
  await getKv().set(tasksKey(slug, version), tasks);
}

async function listTasks(slug, version) {
  const tasks = await loadTasks(slug, version);
  // Lazy backfill: any task created before seq existed gets one assigned now,
  // in creation order, so the prefixed id is stable from here on.
  const missing = tasks.filter(t => t.seq == null);
  if (missing.length) {
    missing.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    for (const t of missing) t.seq = await nextSeq(slug);
    await saveTasks(slug, version, tasks);
  }
  return computeNumbers(tasks);
}

async function getTask(slug, version, taskId) {
  const tasks = await loadTasks(slug, version);
  return tasks.find(t => t.id === taskId) || null;
}

// Set on the task returned by createTask when the id already existed, i.e. the client
// retried a POST whose response it never saw. Symbols do not survive JSON.stringify,
// so this never reaches the wire — it only tells the route to skip the audit/history
// writes it already performed on the first attempt.
const REPLAYED = Symbol('replayed');

const CLIENT_ID_RE = /^[A-Za-z0-9_-]{4,64}$/;

async function createTask(slug, version, data) {
  const tasks = await loadTasks(slug, version);

  // Clients generate the id so a queued create can be referenced by later queued
  // writes before it reaches redis, and so replaying it is a no-op instead of a
  // duplicate row. Must be checked before nextSeq(), which is not idempotent.
  const clientId = typeof data.id === 'string' && CLIENT_ID_RE.test(data.id) ? data.id : null;
  if (clientId) {
    const existing = tasks.find(t => t.id === clientId);
    if (existing) return Object.assign({ ...existing }, { [REPLAYED]: true });
  }

  const seq = await nextSeq(slug);
  const { title, description, status, priority, assignees, assignee, assignedBy, startDate, dueDate, parentId, numberOverride } = data;

  const siblings = tasks.filter(t => (t.parentId || null) === (parentId || null));
  const order = siblings.length > 0 ? Math.max(...siblings.map(t => t.order)) + 1 : 0;

  const normalizedAssignees = Array.isArray(assignees) ? assignees : (assignee ? [assignee] : []);

  const task = {
    id: clientId || `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    seq,
    title: title || 'Untitled',
    description: description || '',
    status: status || 'todo',
    priority: priority || 'medium',
    assignees: normalizedAssignees,
    assignedBy: assignedBy || null,
    startDate: startDate || null,
    dueDate: dueDate || null,
    parentId: parentId || null,
    order,
    boardOrder: order,
    numberOverride: numberOverride || null,
    labelIds: Array.isArray(data.labelIds) ? data.labelIds : [],
    attachments: Array.isArray(data.attachments) ? data.attachments : [],
    cover: data.cover || null,
    archived: false,
    updates: [],
    createdAt: new Date().toISOString(),
  };

  tasks.push(task);
  await saveTasks(slug, version, tasks);
  return task;
}

async function updateTask(slug, version, taskId, updates) {
  const tasks = await loadTasks(slug, version);
  const idx = tasks.findIndex(t => t.id === taskId);
  if (idx === -1) return null;

  const patch = { ...updates };
  // Admin override of the immutable display-id number. Must be a unique positive
  // integer across the whole project.
  if ('seq' in patch) {
    const n = Number(patch.seq);
    if (!Number.isInteger(n) || n < 1) throw new TaskIdError('Task ID number must be a positive whole number.');
    const taken = await projectSeqs(slug, { excludeId: taskId });
    if (taken.includes(n)) throw new TaskIdError(`Task ID number ${n} is already used in this project.`);
    patch.seq = n;
    // Keep the counter ahead so future auto-assigned ids never collide with this one.
    const counter = Number(await getKv().get(`taskseq:${slug}`)) || 0;
    if (n > counter) await getKv().set(`taskseq:${slug}`, n);
  }

  tasks[idx] = { ...tasks[idx], ...patch, updatedAt: new Date().toISOString() };
  await saveTasks(slug, version, tasks);
  return tasks[idx];
}

async function deleteTask(slug, version, taskId) {
  const tasks = await loadTasks(slug, version);
  const toDelete = new Set([taskId]);

  let changed = true;
  while (changed) {
    changed = false;
    tasks.forEach(t => {
      if (t.parentId && toDelete.has(t.parentId) && !toDelete.has(t.id)) {
        toDelete.add(t.id);
        changed = true;
      }
    });
  }

  await saveTasks(slug, version, tasks.filter(t => !toDelete.has(t.id)));
  return toDelete.size;
}

async function reorderTask(slug, version, taskId, direction) {
  const tasks = await loadTasks(slug, version);
  const task = tasks.find(t => t.id === taskId);
  if (!task) return null;

  const siblings = tasks
    .filter(t => (t.parentId || null) === (task.parentId || null))
    .sort((a, b) => a.order - b.order);

  const idx = siblings.findIndex(t => t.id === taskId);

  if (direction === 'up' && idx > 0) {
    const prev = tasks.find(t => t.id === siblings[idx - 1].id);
    const curr = tasks.find(t => t.id === taskId);
    [prev.order, curr.order] = [curr.order, prev.order];
  } else if (direction === 'down' && idx < siblings.length - 1) {
    const next = tasks.find(t => t.id === siblings[idx + 1].id);
    const curr = tasks.find(t => t.id === taskId);
    [next.order, curr.order] = [curr.order, next.order];
  }

  await saveTasks(slug, version, tasks);
  return computeNumbers(tasks);
}

async function moveTask(slug, version, taskId, targetId, position) {
  const tasks = await loadTasks(slug, version);
  const task = tasks.find(t => t.id === taskId);
  const target = tasks.find(t => t.id === targetId);
  if (!task || !target || taskId === targetId) return computeNumbers(tasks);

  function getDescendants(id) {
    const set = new Set();
    const q = [id];
    while (q.length) {
      const cur = q.shift();
      for (const t of tasks) {
        if (t.parentId === cur && !set.has(t.id)) { set.add(t.id); q.push(t.id); }
      }
    }
    return set;
  }

  const descendants = getDescendants(taskId);

  if (position === 'child') {
    if (descendants.has(targetId)) return computeNumbers(tasks);
    const siblings = tasks.filter(t => (t.parentId || null) === targetId && t.id !== taskId);
    const maxOrder = siblings.length > 0 ? Math.max(...siblings.map(t => t.order)) : -1;
    task.parentId = targetId;
    task.order = maxOrder + 1;
  } else {
    const newParentId = target.parentId || null;
    if (newParentId === taskId || (newParentId !== null && descendants.has(newParentId))) return computeNumbers(tasks);
    const siblings = tasks
      .filter(t => (t.parentId || null) === newParentId && t.id !== taskId)
      .sort((a, b) => a.order - b.order);
    const targetIdx = siblings.findIndex(t => t.id === targetId);
    if (targetIdx === -1) return computeNumbers(tasks);
    const insertAt = position === 'before' ? targetIdx : targetIdx + 1;
    siblings.splice(insertAt, 0, task);
    task.parentId = newParentId;
    siblings.forEach((t, i) => { const x = tasks.find(u => u.id === t.id); if (x) x.order = i; });
  }

  await saveTasks(slug, version, tasks);
  return computeNumbers(tasks);
}

// Bulk-restore parentId/order for a set of tasks. Used by the tree "undo" to revert
// a drag-move to the exact pre-move layout captured on the client.
async function restorePositions(slug, version, positions) {
  const tasks = await loadTasks(slug, version);
  const byId = {};
  tasks.forEach(t => { byId[t.id] = t; });
  for (const p of positions || []) {
    const t = byId[p.id];
    if (!t) continue;
    t.parentId = p.parentId || null;
    if (typeof p.order === 'number') t.order = p.order;
  }
  await saveTasks(slug, version, tasks);
  return computeNumbers(tasks);
}

// Reassign boardOrder (kanban within-column ordering) for the given ids in sequence.
// Kept separate from `order` so reordering a board column never disturbs tree numbering.
async function reorderBoard(slug, version, status, orderedIds) {
  const tasks = await loadTasks(slug, version);
  const pos = {};
  orderedIds.forEach((id, i) => { pos[id] = i; });
  tasks.forEach(t => { if (t.id in pos) t.boardOrder = pos[t.id]; });
  await saveTasks(slug, version, tasks);
  return computeNumbers(tasks);
}

module.exports = { listTasks, getTask, createTask, updateTask, deleteTask, reorderTask, moveTask, restorePositions, reorderBoard, TaskIdError, REPLAYED };
