const { Redis } = require('@upstash/redis')
let _kv;
function getKv() { if (!_kv) _kv = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN, enableAutoPipelining: true }); return _kv; }

// Per-task activity log. One Redis list per task, oldest → newest.
const MAX_HISTORY = 500
const MAX_TEXT = 300

function histKey(slug, version, taskId) {
  return `taskhistory:${slug}:${version || '__root'}:${taskId}`
}

// Friendly labels for the fields we surface in history.
const FIELD_LABEL = {
  title: 'Title', description: 'Description', status: 'Status', priority: 'Priority',
  assignees: 'Assignees', assignedBy: 'Assigned by', startDate: 'Start date',
  dueDate: 'Due date', parentId: 'Parent', numberOverride: 'Number',
  category: 'Category',
  labelIds: 'Labels', cover: 'Cover image', attachments: 'Attachments',
}
const FIELD_ORDER = Object.keys(FIELD_LABEL)

function normAssignees(v) {
  const list = Array.isArray(v) ? v : (v ? [v] : [])
  return list.map(a => (typeof a === 'object' ? a?.name : a)).filter(Boolean)
}

function truncate(s) {
  if (s == null) return s
  const str = String(s)
  return str.length > MAX_TEXT ? str.slice(0, MAX_TEXT) + '…' : str
}

// Build the list of human-readable field changes between a task and an update payload.
function buildChanges(before, updates) {
  const changes = []
  before = before || {}
  for (const field of FIELD_ORDER) {
    if (!(field in updates)) continue

    if (field === 'assignees') {
      const from = normAssignees(before.assignees != null ? before.assignees : before.assignee)
      const to = normAssignees(updates.assignees)
      if (JSON.stringify(from) !== JSON.stringify(to)) {
        changes.push({ field, label: FIELD_LABEL[field], from: from.join(', ') || '—', to: to.join(', ') || '—' })
      }
      continue
    }
    if (field === 'labelIds') {
      const from = Array.isArray(before.labelIds) ? before.labelIds : []
      const to = Array.isArray(updates.labelIds) ? updates.labelIds : []
      if (JSON.stringify([...from].sort()) !== JSON.stringify([...to].sort())) {
        changes.push({ field, label: FIELD_LABEL[field], from: `${from.length} label(s)`, to: `${to.length} label(s)` })
      }
      continue
    }
    if (field === 'attachments') {
      const from = Array.isArray(before.attachments) ? before.attachments.length : 0
      const to = Array.isArray(updates.attachments) ? updates.attachments.length : 0
      if (from !== to) changes.push({ field, label: FIELD_LABEL[field], from: `${from} image(s)`, to: `${to} image(s)` })
      continue
    }
    if (field === 'cover') {
      const from = before.cover?.attId || null
      const to = updates.cover?.attId || null
      if (from !== to) changes.push({ field, label: FIELD_LABEL[field], from: from ? 'set' : 'none', to: to ? 'set' : 'none' })
      continue
    }

    // Generic scalar fields
    const from = before[field] == null ? '' : before[field]
    const to = updates[field] == null ? '' : updates[field]
    if (String(from) !== String(to)) {
      changes.push({ field, label: FIELD_LABEL[field], from: truncate(from) || '—', to: truncate(to) || '—' })
    }
  }
  return changes
}

async function recordTaskHistory(slug, version, taskId, entry) {
  try {
    const full = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      ...entry,
    }
    const key = histKey(slug, version, taskId)
    await Promise.all([
      getKv().rpush(key, JSON.stringify(full)),
      getKv().ltrim(key, -MAX_HISTORY, -1),
    ])
  } catch {
    // Never let history logging break the main flow.
  }
}

// Log task creation.
async function recordTaskCreate(slug, version, taskId, actor, task) {
  await recordTaskHistory(slug, version, taskId, {
    action: 'created',
    actor: actor ? { name: actor.name, username: actor.username } : null,
    meta: { title: task?.title || null, status: task?.status || null },
  })
}

// Diff a task update and log the appropriate entries (field changes, comments, archive toggle).
async function recordTaskUpdate(slug, version, taskId, actor, before, updates) {
  const a = actor ? { name: actor.name, username: actor.username } : null
  updates = updates || {}

  // Comment added / removed via the `updates` array.
  if ('updates' in updates) {
    const beforeLen = Array.isArray(before?.updates) ? before.updates.length : 0
    const afterArr = Array.isArray(updates.updates) ? updates.updates : []
    if (afterArr.length > beforeLen) {
      const added = afterArr.slice(beforeLen)
      for (const c of added) {
        await recordTaskHistory(slug, version, taskId, {
          action: 'commented', actor: a,
          meta: { text: truncate(c?.text), author: c?.author || null },
        })
      }
    } else if (afterArr.length < beforeLen) {
      await recordTaskHistory(slug, version, taskId, { action: 'comment_removed', actor: a })
    }
  }

  // Archive / restore toggle.
  if ('archived' in updates && !!updates.archived !== !!before?.archived) {
    await recordTaskHistory(slug, version, taskId, { action: updates.archived ? 'archived' : 'restored', actor: a })
  }

  const changes = buildChanges(before, updates)
  if (changes.length) {
    await recordTaskHistory(slug, version, taskId, { action: 'updated', actor: a, changes })
  }
}

async function getTaskHistory(slug, version, taskId, { limit = MAX_HISTORY } = {}) {
  try {
    const raw = await getKv().lrange(histKey(slug, version, taskId), -limit, -1)
    const items = (raw || [])
      .map(e => { try { return typeof e === 'string' ? JSON.parse(e) : e } catch { return null } })
      .filter(Boolean)
    return items.reverse() // newest first
  } catch {
    return []
  }
}

async function deleteTaskHistory(slug, version, taskId) {
  try { await getKv().del(histKey(slug, version, taskId)) } catch {}
}

module.exports = {
  recordTaskHistory, recordTaskCreate, recordTaskUpdate, getTaskHistory, deleteTaskHistory, buildChanges,
}
