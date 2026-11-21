const { Redis } = require('@upstash/redis');
const { listTasksByVersion, withTaskLock, loadTasks, saveTasks } = require('./task-store');

let _kv;
function getKv() { if (!_kv) _kv = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN, enableAutoPipelining: true }); return _kv; }

// Epic › story › sub-task. An epic is a project-level entity that groups STORIES —
// root-level tasks (`parentId === null`). Only a story carries `epicId`; a sub-task
// belongs to its story's epic and never stores one of its own, so moving a story
// between epics moves its whole subtree without touching a single sub-task.
//
// One key per epic (`epic:{slug}:{id}`) plus an index set (`epics:{slug}`), the same
// shape as proposals: two admins editing different epics never clobber each other,
// which a single-array key like `categories:{slug}` would.
//
// Epics span versions. Stories live in per-version task lists, so progress is
// aggregated across every list of the project.

const EPIC_STATUSES = ['planned', 'in-progress', 'done'];
const MAX_NAME = 120;
const MAX_DESC = 4000;

class EpicError extends Error {
  constructor(message, status = 400) { super(message); this.code = 'EPIC'; this.status = status; }
}

const epicKey = (slug, id) => `epic:${slug}:${id}`;
const indexKey = slug => `epics:${slug}`;

function isDate(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v); }

// Whitelist + clamp. `partial` lets an update omit fields instead of resetting them.
function sanitizeEpic(data, { partial = false } = {}) {
  const src = data || {};
  const out = {};
  if (!partial || 'name' in src) {
    const name = typeof src.name === 'string' ? src.name.trim().slice(0, MAX_NAME) : '';
    if (!name) throw new EpicError('Epic name is required.');
    out.name = name;
  }
  if (!partial || 'description' in src) out.description = typeof src.description === 'string' ? src.description.slice(0, MAX_DESC) : '';
  if (!partial || 'color' in src) out.color = typeof src.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(src.color) ? src.color : '#8b5cf6';
  if (!partial || 'status' in src) out.status = EPIC_STATUSES.includes(src.status) ? src.status : 'planned';
  if (!partial || 'owner' in src) out.owner = typeof src.owner === 'string' && src.owner.trim() ? src.owner.trim() : null;
  if (!partial || 'startDate' in src) out.startDate = isDate(src.startDate) ? src.startDate : null;
  if (!partial || 'targetDate' in src) out.targetDate = isDate(src.targetDate) ? src.targetDate : null;
  if (out.startDate && out.targetDate && out.targetDate < out.startDate) {
    throw new EpicError('Target date cannot be before the start date.');
  }
  return out;
}

async function listEpicRecords(slug) {
  const ids = (await getKv().smembers(indexKey(slug))) || [];
  if (!ids.length) return [];
  const rows = await getKv().mget(...ids.map(id => epicKey(slug, id)));
  return rows.filter(Boolean).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.createdAt).localeCompare(String(b.createdAt)));
}

async function getEpic(slug, id) {
  if (typeof id !== 'string' || !id) return null;
  return (await getKv().get(epicKey(slug, id))) || null;
}

async function epicExists(slug, id) {
  return !!(await getKv().sismember(indexKey(slug), id));
}

async function createEpic(slug, data, actor) {
  const clean = sanitizeEpic(data);
  const existing = (await getKv().smembers(indexKey(slug))) || [];
  const now = new Date().toISOString();
  const epic = {
    id: `epic-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    ...clean,
    order: existing.length,
    createdBy: actor || null,
    createdAt: now,
    updatedAt: now,
  };
  await getKv().set(epicKey(slug, epic.id), epic);
  await getKv().sadd(indexKey(slug), epic.id);
  return epic;
}

async function updateEpic(slug, id, data) {
  const existing = await getEpic(slug, id);
  if (!existing) return null;
  const patch = sanitizeEpic(data, { partial: true });
  const merged = { ...existing, ...patch };
  if (merged.startDate && merged.targetDate && merged.targetDate < merged.startDate) {
    throw new EpicError('Target date cannot be before the start date.');
  }
  const updated = { ...merged, updatedAt: new Date().toISOString() };
  await getKv().set(epicKey(slug, id), updated);
  return updated;
}

// Deleting an epic unlinks its stories rather than leaving them pointing at nothing.
// Each list is rewritten under its own task lock, and only lists that actually hold a
// linked story are touched.
async function deleteEpic(slug, id) {
  const existing = await getEpic(slug, id);
  if (!existing) return null;
  const groups = await listTasksByVersion(slug);
  let unlinked = 0;
  for (const g of groups) {
    if (!g.tasks.some(t => t.epicId === id)) continue;
    unlinked += await withTaskLock(slug, g.version, async () => {
      const tasks = await loadTasks(slug, g.version);
      let n = 0;
      const next = tasks.map(t => {
        if (t.epicId !== id) return t;
        n++;
        return { ...t, epicId: null };
      });
      if (n) await saveTasks(slug, g.version, next);
      return n;
    });
  }
  await getKv().del(epicKey(slug, id));
  await getKv().srem(indexKey(slug), id);
  return { unlinked };
}

async function deleteAllEpics(slug) {
  const ids = (await getKv().smembers(indexKey(slug))) || [];
  await Promise.all([...ids.map(id => getKv().del(epicKey(slug, id))), getKv().del(indexKey(slug))]);
}

// --- Progress -------------------------------------------------------------------

// Every task under `rootId` in one list, the story itself excluded.
function descendants(rootId, childrenOf) {
  const out = [];
  const stack = [...(childrenOf[rootId] || [])];
  const seen = new Set();
  while (stack.length) {
    const t = stack.pop();
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
    stack.push(...(childrenOf[t.id] || []));
  }
  return out;
}

const pts = t => (Number.isFinite(t.points) && t.points > 0 ? t.points : 1);

// Stories (with their sub-task roll-up) for every epic, across all version lists.
// Archived stories and archived sub-tasks are left out of the counts.
// Pass `groups` when the caller already loaded the task lists.
async function storiesByEpic(slug, groups) {
  if (!groups) groups = await listTasksByVersion(slug);
  const byEpic = {};
  for (const g of groups) {
    const live = g.tasks.filter(t => !t.archived);
    const childrenOf = {};
    for (const t of live) {
      if (!t.parentId) continue;
      (childrenOf[t.parentId] = childrenOf[t.parentId] || []).push(t);
    }
    for (const story of live) {
      if (story.parentId || !story.epicId) continue;
      const subs = descendants(story.id, childrenOf);
      (byEpic[story.epicId] = byEpic[story.epicId] || []).push({
        id: story.id,
        seq: story.seq ?? null,
        number: story.number || '',
        title: story.title,
        status: story.status,
        priority: story.priority,
        assignees: story.assignees || [],
        dueDate: story.dueDate || null,
        points: story.points ?? null,
        version: g.version,
        subtasks: subs.length,
        subtasksDone: subs.filter(s => s.status === 'done').length,
      });
    }
  }
  return byEpic;
}

function rollup(stories) {
  const list = stories || [];
  return {
    stories: list.length,
    storiesDone: list.filter(s => s.status === 'done').length,
    subtasks: list.reduce((n, s) => n + s.subtasks, 0),
    subtasksDone: list.reduce((n, s) => n + s.subtasksDone, 0),
    points: list.reduce((n, s) => n + pts(s), 0),
    pointsDone: list.filter(s => s.status === 'done').reduce((n, s) => n + pts(s), 0),
  };
}

async function listEpics(slug, groups) {
  const [epics, byEpic] = await Promise.all([listEpicRecords(slug), storiesByEpic(slug, groups)]);
  return epics.map(e => ({ ...e, progress: rollup(byEpic[e.id]) }));
}

async function getEpicWithStories(slug, id) {
  const epic = await getEpic(slug, id);
  if (!epic) return null;
  const stories = (await storiesByEpic(slug))[id] || [];
  return { epic: { ...epic, progress: rollup(stories) }, stories };
}

// Route-level guard for any write that sets `epicId` on a task. Returns an error
// message, or null when the link is fine. `parentId` is the task's parent AFTER the
// write, so a create and an update that also reparents are both judged correctly.
async function epicLinkError(slug, epicId, parentId) {
  if (epicId === undefined || epicId === null || epicId === '') return null;
  if (typeof epicId !== 'string') return 'epicId must be an epic id.';
  if (parentId) return 'Only a story (a top-level task) can be linked to an epic. Sub-tasks follow their story.';
  if (!await epicExists(slug, epicId)) return 'That epic does not exist in this project.';
  return null;
}

module.exports = {
  EPIC_STATUSES,
  EpicError,
  listEpics,
  getEpic,
  getEpicWithStories,
  createEpic,
  updateEpic,
  deleteEpic,
  deleteAllEpics,
  epicLinkError,
};
