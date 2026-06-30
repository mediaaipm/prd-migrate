const { Redis } = require('@upstash/redis');
let _kv;
function getKv() { if (!_kv) _kv = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN }); return _kv; }

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

// Next display-id number = largest existing number + 1, never below the project's
// start. The redis counter is kept as an extra floor so two concurrent creates
// (which both read the same max) still get distinct numbers. Ids are never reused.
async function nextSeq(slug) {
  const [start, seqs, counterRaw] = await Promise.all([
    seqStart(slug),
    projectSeqs(slug),
    getKv().get(`taskseq:${slug}`),
  ]);
  const counter = Number(counterRaw) || 0;
  const maxExisting = seqs.length ? Math.max(...seqs) : 0;
  const next = Math.max(start - 1, maxExisting, counter) + 1;
  await getKv().set(`taskseq:${slug}`, next);
  return next;
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

async function createTask(slug, version, data) {
  const tasks = await loadTasks(slug, version);
  const { title, description, status, priority, assignees, assignee, assignedBy, startDate, dueDate, parentId, numberOverride } = data;

  const siblings = tasks.filter(t => (t.parentId || null) === (parentId || null));
  const order = siblings.length > 0 ? Math.max(...siblings.map(t => t.order)) + 1 : 0;

  const normalizedAssignees = Array.isArray(assignees) ? assignees : (assignee ? [assignee] : []);

  const seq = await nextSeq(slug);

  const task = {
    id: `task-${Date.now()}`,
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
    attachments: [],
    cover: null,
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

module.exports = { listTasks, getTask, createTask, updateTask, deleteTask, reorderTask, moveTask, reorderBoard, TaskIdError };
