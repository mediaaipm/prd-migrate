const { Redis } = require('@upstash/redis');
let _kv;
function getKv() { if (!_kv) _kv = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN }); return _kv; }

function tasksKey(slug, version) {
  return version ? `tasks:${slug}:${version}` : `tasks:${slug}:__root`;
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
  return computeNumbers(tasks);
}

async function getTask(slug, version, taskId) {
  const tasks = await loadTasks(slug, version);
  return tasks.find(t => t.id === taskId) || null;
}

async function createTask(slug, version, data) {
  const tasks = await loadTasks(slug, version);
  const { title, description, status, priority, assignees, assignee, startDate, dueDate, parentId, numberOverride } = data;

  const siblings = tasks.filter(t => (t.parentId || null) === (parentId || null));
  const order = siblings.length > 0 ? Math.max(...siblings.map(t => t.order)) + 1 : 0;

  const normalizedAssignees = Array.isArray(assignees) ? assignees : (assignee ? [assignee] : []);

  const task = {
    id: `task-${Date.now()}`,
    title: title || 'Untitled',
    description: description || '',
    status: status || 'todo',
    priority: priority || 'medium',
    assignees: normalizedAssignees,
    startDate: startDate || null,
    dueDate: dueDate || null,
    parentId: parentId || null,
    order,
    numberOverride: numberOverride || null,
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
  tasks[idx] = { ...tasks[idx], ...updates, updatedAt: new Date().toISOString() };
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

module.exports = { listTasks, getTask, createTask, updateTask, deleteTask, reorderTask };
