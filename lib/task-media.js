// Attachments and cover images are stored inline in the task record as base64
// data URLs. That is cheap to write but ruinous to read: every task-list GET,
// every drag-reorder PATCH and every sprint GET used to ship the full base64 of
// every image, uncacheable, straight out of a function. That is Fast Origin
// Transfer, and it is what blew the quota.
//
// The fix is to keep the storage shape unchanged but never put base64 on a list
// response. Lists carry metadata plus a `url`; the bytes come from
// /api/projects/{slug}/media/{taskId}/{attId}, which is individually cacheable
// and revalidates with an ETag.
//
// Two invariants matter:
//   1. strip* is applied at every route that returns task objects.
//   2. mergeTaskMedia() is applied at every route that accepts them back, or a
//      round-trip through the edit form would save the stripped copy and destroy
//      the image.

const MAX_ATTACH_BYTES = 1024 * 1024 // must match the client-side cap
const MAX_ATTACH_PER_TASK = 20

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
      if (!att || typeof att !== 'object') return att
      if (!isDataUrl(att.dataUrl)) return att // already stripped
      const { dataUrl, ...rest } = att
      return { ...rest, size: att.size || dataUrlBytes(dataUrl), url: mediaUrl(slug, version, task.id, att.id) }
    })
  }

  if (hasCover) {
    // The normal case: cover.attId already points at an attachment on this task,
    // so cover.dataUrl was always a duplicate of bytes we are keeping anyway.
    if (task.cover.attId) {
      out.cover = { attId: task.cover.attId, url: mediaUrl(slug, version, task.id, task.cover.attId) }
    } else if (isDataUrl(task.cover.dataUrl)) {
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

module.exports = {
  MAX_ATTACH_BYTES,
  MAX_ATTACH_PER_TASK,
  COVER_ATT_ID,
  AttachmentError,
  mediaUrl,
  dataUrlBytes,
  decodeDataUrl,
  stripTaskMedia,
  stripTasksMedia,
  stripTasksMediaPerVersion,
  validateAttachments,
  mergeTaskMedia,
  resolveAttachment,
}
