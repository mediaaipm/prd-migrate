// Attachments and cover images used to be stored inline in the task record as
// base64 data URLs. That is cheap to write but ruinous to read: every task-list
// GET, every drag-reorder PATCH and every sprint GET shipped the full base64 of
// every image, uncacheable, straight out of a function. That is Fast Origin
// Transfer, and it is what blew the quota.
//
// The first fix kept the storage shape and only stripped base64 off responses.
// Lists carry metadata plus a `url`; the bytes come from
// /api/projects/{slug}/media/{taskId}/{attId}, which is individually cacheable
// and revalidates with an ETag.
//
// That fixed transfer but not storage. A project's tasks live in ONE redis
// value, so inlined images accumulated inside it until the list hit Upstash's
// 10 MB max request size and every subsequent write — every task create — died
// with a 500. Bytes now live in their own key, one per attachment, so the task
// list stays metadata-only and its size tracks task count, not image count.
//
// Three invariants matter:
//   1. strip* is applied at every route that returns task objects.
//   2. mergeTaskMedia() is applied at every route that accepts them back, or a
//      round-trip through the edit form would save the stripped copy and destroy
//      the image.
//   3. offloadTasksMedia() runs inside saveTasks(), so EVERY write path — create,
//      update, import, snapshot restore — sheds its bytes before the SET.

const { Redis } = require('@upstash/redis')
let _kv
function getKv() {
  if (!_kv) _kv = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN, enableAutoPipelining: true })
  return _kv
}

const MAX_ATTACH_BYTES = 1024 * 1024 // must match the client-side cap
const MAX_ATTACH_PER_TASK = 20

// One redis key per attachment, holding just the data URL string.
function attKey(slug, version, taskId, attId) {
  return `taskatt:${slug}:${version || '__root'}:${taskId}:${attId}`
}

// Sentinel for a legacy cover that carries its own dataUrl with no attId to
// point at. Lets the media route serve it so nothing has to stay inline.
const COVER_ATT_ID = '__cover'

function mediaUrl(slug, version, taskId, attId) {
  const base = `/api/projects/${encodeURIComponent(slug)}/media/${encodeURIComponent(taskId)}/${encodeURIComponent(attId)}`
  return version ? `${base}?version=${encodeURIComponent(version)}` : base
}

function isDataUrl(v) {
  return typeof v === 'string' && v.startsWith('data:')
}

// Byte length of the payload a data URL decodes to, without allocating it.
function dataUrlBytes(dataUrl) {
  if (!isDataUrl(dataUrl)) return 0
  const comma = dataUrl.indexOf(',')
  if (comma === -1) return 0
  const b64 = dataUrl.slice(comma + 1)
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.floor((b64.length * 3) / 4) - padding
}

function decodeDataUrl(dataUrl) {
  if (!isDataUrl(dataUrl)) return null
  const comma = dataUrl.indexOf(',')
  if (comma === -1) return null
  const meta = dataUrl.slice(5, comma) // strip "data:"
  const isB64 = meta.endsWith(';base64')
  const contentType = (isB64 ? meta.slice(0, -7) : meta) || 'application/octet-stream'
  const payload = dataUrl.slice(comma + 1)
  const buf = isB64
    ? Buffer.from(payload, 'base64')
    : Buffer.from(decodeURIComponent(payload), 'utf8')
  return { contentType, buf }
}

// Replace every inline data URL on a task with a reference to the media route.
function stripTaskMedia(task, slug, version) {
  if (!task || typeof task !== 'object') return task
  const hasAttachments = Array.isArray(task.attachments) && task.attachments.length > 0
  const hasCover = task.cover && typeof task.cover === 'object'
  if (!hasAttachments && !hasCover) return task

  const out = { ...task }

  if (hasAttachments) {
    out.attachments = task.attachments.map(att => {
      if (!att || typeof att !== 'object' || !att.id) return att
      // Bytes may be inline (a create that has not been offloaded yet) or already
      // in their own key. Either way the client gets a url, never the base64.
      const { dataUrl, ...rest } = att
      return { ...rest, size: att.size || dataUrlBytes(dataUrl), url: mediaUrl(slug, version, task.id, att.id) }
    })
  }

  if (hasCover) {
    // The normal case: cover.attId already points at an attachment on this task,
    // so cover.dataUrl was always a duplicate of bytes we are keeping anyway.
    if (task.cover.attId) {
      out.cover = { attId: task.cover.attId, url: mediaUrl(slug, version, task.id, task.cover.attId) }
    } else if (isDataUrl(task.cover.dataUrl) || task.cover.stored) {
      out.cover = { attId: null, url: mediaUrl(slug, version, task.id, COVER_ATT_ID) }
    }
  }

  return out
}

function stripTasksMedia(tasks, slug, version) {
  if (!Array.isArray(tasks)) return tasks
  return tasks.map(t => stripTaskMedia(t, slug, version))
}

// Dashboard-style rows carry their own `_version` rather than sharing one.
function stripTasksMediaPerVersion(tasks, slug) {
  if (!Array.isArray(tasks)) return tasks
  return tasks.map(t => stripTaskMedia(t, slug, t?._version === '__root' ? null : t?._version))
}

class AttachmentError extends Error {
  constructor(message) { super(message); this.code = 'ATTACHMENT' }
}

// Enforce the size cap server-side. The client checks too, but that check is
// advisory — nothing stopped a direct POST from storing an arbitrarily large blob.
function validateAttachments(attachments) {
  if (attachments == null) return
  if (!Array.isArray(attachments)) throw new AttachmentError('attachments must be an array.')
  if (attachments.length > MAX_ATTACH_PER_TASK) {
    throw new AttachmentError(`Too many attachments (max ${MAX_ATTACH_PER_TASK} per task).`)
  }
  for (const att of attachments) {
    if (!att || typeof att !== 'object' || !isDataUrl(att.dataUrl)) continue
    const bytes = dataUrlBytes(att.dataUrl)
    if (bytes > MAX_ATTACH_BYTES) {
      throw new AttachmentError(`"${att.name || 'attachment'}" is too large (max ${Math.round(MAX_ATTACH_BYTES / 1024)}KB).`)
    }
  }
}

// Restore the bytes a stripped client round-trip left behind.
//
// The edit form loads a task from a list response (no dataUrl), then PUTs the
// whole task back. Without this, `{...before, ...updates}` in updateTask would
// overwrite each attachment with its stripped twin and the image would be gone.
// Matching is by attachment id, which the client preserves.
function mergeTaskMedia(updates, before) {
  if (!updates || typeof updates !== 'object') return updates
  const merged = { ...updates }
  const priorAtts = Array.isArray(before?.attachments) ? before.attachments : []
  const priorById = new Map(priorAtts.filter(a => a && a.id).map(a => [a.id, a]))

  if (Array.isArray(updates.attachments)) {
    merged.attachments = updates.attachments.map(att => {
      if (!att || typeof att !== 'object') return att
      if (isDataUrl(att.dataUrl)) {
        // A genuinely new upload. Drop any url the client echoed back.
        const { url, ...rest } = att
        return rest
      }
      const prior = priorById.get(att.id)
      if (prior && isDataUrl(prior.dataUrl)) {
        // Metadata may have changed; the bytes did not.
        const { url, ...rest } = att
        return { ...rest, dataUrl: prior.dataUrl }
      }
      return att
    })
  }

  if ('cover' in updates) {
    if (!updates.cover) {
      merged.cover = null
    } else if (updates.cover.attId) {
      // Store the reference only — never a second copy of the bytes.
      merged.cover = { attId: updates.cover.attId }
    } else if (isDataUrl(updates.cover.dataUrl)) {
      merged.cover = { attId: null, dataUrl: updates.cover.dataUrl }
    } else {
      // Stripped legacy cover echoed back with no attId; keep what we had.
      merged.cover = before?.cover || null
    }
  }

  return merged
}

// Resolve the stored bytes for one attachment id on an already-loaded task.
// Inline records only — see loadAttachment() for the offloaded case.
function resolveAttachment(task, attId) {
  if (!task) return null
  if (attId === COVER_ATT_ID) {
    const decoded = decodeDataUrl(task.cover?.dataUrl)
    return decoded ? { ...decoded, name: 'cover' } : null
  }
  const att = (task.attachments || []).find(a => a && a.id === attId)
  if (!att) return null
  const decoded = decodeDataUrl(att.dataUrl)
  if (!decoded) return null
  return { contentType: att.type || decoded.contentType, buf: decoded.buf, name: att.name || attId }
}

// The bytes for one attachment, read straight from its own key — no task record
// needed, so no 500 KB task-list load to serve one image.
//
// The reachable key space is exactly `taskatt:{slug}:*`, and `slug` has already
// passed the project ACL by the time this is called. `taskId`/`attId` only extend
// the tail of that prefix, so a caller can address this project's attachments and
// nothing else — which is the same set the task list would have shown them anyway.
//
// The content type comes out of the data URL itself, so the attachment's metadata
// record is not needed either.
async function readAttachmentKey(slug, version, taskId, attId) {
  if (!slug || !taskId || !attId) return null
  const stored = await getKv().get(attKey(slug, version, taskId, attId))
  const decoded = decodeDataUrl(stored)
  if (!decoded) return null
  return { contentType: decoded.contentType, buf: decoded.buf, name: attId }
}

// The bytes for one attachment, wherever they live. Inline first (a record written
// before the offload, or one mid-flight), then its own key.
//
// `attId` reaches redis as part of a key name, so it is only ever looked up after
// it has been matched against something actually attached to this task — never
// taken from the URL on trust.
async function loadAttachment(slug, version, task, attId) {
  const inline = resolveAttachment(task, attId)
  if (inline) return inline
  if (!task || !task.id) return null

  let att = null
  if (attId === COVER_ATT_ID) {
    if (!task.cover || task.cover.attId || !task.cover.stored) return null
  } else {
    att = (task.attachments || []).find(a => a && a.id === attId)
    if (!att) return null
  }

  const stored = await getKv().get(attKey(slug, version, task.id, attId))
  const decoded = decodeDataUrl(stored)
  if (!decoded) return null
  return {
    contentType: (att && att.type) || decoded.contentType,
    buf: decoded.buf,
    name: (att && att.name) || (attId === COVER_ATT_ID ? 'cover' : attId),
  }
}

let attIdSeq = 0
function newAttId() {
  attIdSeq = (attIdSeq + 1) % 1e6
  return `att-${Date.now().toString(36)}-${attIdSeq.toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

// Move every inline data URL on a task into its own key and return the slimmed
// record. Bytes are written BEFORE the caller saves the task list, so a crash in
// between leaves an unreferenced key — never a task pointing at bytes that were
// never stored.
async function offloadTaskMedia(slug, version, task) {
  if (!task || typeof task !== 'object' || !task.id) return task

  const writes = []
  let out = task

  if (Array.isArray(task.attachments)) {
    let changed = false
    const attachments = task.attachments.map(att => {
      if (!att || typeof att !== 'object') return att
      // `url` is what strip* handed the client; it is derived, never stored.
      const { dataUrl, url, ...rest } = att
      if (!isDataUrl(dataUrl)) {
        if (url !== undefined) { changed = true; return rest }
        return att
      }
      changed = true
      const id = rest.id || newAttId()
      writes.push([attKey(slug, version, task.id, id), dataUrl])
      return { ...rest, id, size: rest.size || dataUrlBytes(dataUrl) }
    })
    if (changed) out = { ...out, attachments }
  }

  const cover = task.cover
  if (cover && typeof cover === 'object') {
    if (cover.attId) {
      // The bytes already live on the attachment this points at. A cover.dataUrl
      // here is a second copy of them — pure weight in the list.
      if (cover.dataUrl !== undefined || cover.url !== undefined) out = { ...out, cover: { attId: cover.attId } }
    } else if (isDataUrl(cover.dataUrl)) {
      // A legacy cover carrying its own bytes, with no attachment to point at.
      // `stored` marks that they now live under the __cover key.
      writes.push([attKey(slug, version, task.id, COVER_ATT_ID), cover.dataUrl])
      out = { ...out, cover: { attId: null, stored: true } }
    } else if (cover.url !== undefined) {
      const { url, ...rest } = cover
      out = { ...out, cover: rest }
    }
  }

  if (writes.length) await Promise.all(writes.map(([k, v]) => getKv().set(k, v)))
  return out
}

async function offloadTasksMedia(slug, version, tasks) {
  if (!Array.isArray(tasks)) return tasks
  // Sequential on purpose: a bulk import of image-heavy tasks would otherwise
  // open one redis connection per attachment across the whole list at once.
  const out = []
  for (const t of tasks) out.push(await offloadTaskMedia(slug, version, t))
  return out
}

// Put the bytes back inline. Only for callers that genuinely need a
// self-contained copy — the `?media=1` export.
async function hydrateTaskMedia(slug, version, task) {
  if (!task || typeof task !== 'object' || !task.id) return task
  const out = { ...task }

  if (Array.isArray(task.attachments)) {
    out.attachments = await Promise.all(task.attachments.map(async att => {
      if (!att || typeof att !== 'object' || !att.id || isDataUrl(att.dataUrl)) return att
      const stored = await getKv().get(attKey(slug, version, task.id, att.id))
      const { url, ...rest } = att
      return isDataUrl(stored) ? { ...rest, dataUrl: stored } : rest
    }))
  }

  if (task.cover && !task.cover.attId && task.cover.stored) {
    const stored = await getKv().get(attKey(slug, version, task.id, COVER_ATT_ID))
    if (isDataUrl(stored)) out.cover = { attId: null, dataUrl: stored }
  }

  return out
}

async function hydrateTasksMedia(slug, version, tasks) {
  if (!Array.isArray(tasks)) return tasks
  const out = []
  for (const t of tasks) out.push(await hydrateTaskMedia(slug, version, t))
  return out
}

// Drop the byte keys for tasks (or individual attachments) that no longer exist.
// Best-effort: an orphaned key costs storage, never correctness.
async function deleteTasksMedia(slug, version, tasks) {
  const keys = []
  for (const t of tasks || []) {
    if (!t || !t.id) continue
    for (const att of t.attachments || []) {
      if (att && att.id) keys.push(attKey(slug, version, t.id, att.id))
    }
    if (t.cover && !t.cover.attId && t.cover.stored) keys.push(attKey(slug, version, t.id, COVER_ATT_ID))
  }
  if (!keys.length) return 0
  try { await getKv().del(...keys) } catch { return 0 }
  return keys.length
}

module.exports = {
  MAX_ATTACH_BYTES,
  MAX_ATTACH_PER_TASK,
  COVER_ATT_ID,
  AttachmentError,
  attKey,
  mediaUrl,
  dataUrlBytes,
  decodeDataUrl,
  stripTaskMedia,
  stripTasksMedia,
  stripTasksMediaPerVersion,
  validateAttachments,
  mergeTaskMedia,
  resolveAttachment,
  loadAttachment,
  readAttachmentKey,
  offloadTaskMedia,
  offloadTasksMedia,
  hydrateTaskMedia,
  hydrateTasksMedia,
  deleteTasksMedia,
}
