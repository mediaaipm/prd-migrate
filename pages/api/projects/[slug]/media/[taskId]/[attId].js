const crypto = require('crypto');
const { getTask } = require('../../../../../../lib/task-store');
const { requirePermission, requireProjectAccess } = require('../../../../../../lib/require-permission');
const { resolveAttachment } = require('../../../../../../lib/task-media');

// Serves the bytes for one attachment. Task lists now carry a `url` pointing here
// instead of an inline data URL, which is the whole point: this response is
// individually cacheable and revalidates cheaply, where a base64 blob buried in a
// JSON list response could never be cached at all.
//
// Cache-Control is `private` — these sit behind a per-project ACL, so they must
// not land in a shared edge cache. The browser cache is where the saving is: the
// same board reload previously re-downloaded every image, every time.
export default async function handler(req, res) {
  const { slug, taskId, attId, version } = req.query;

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!await requireProjectAccess(slug, req, res)) return;
  if (!await requirePermission('task:view', slug)(req, res)) return;

  const task = await getTask(slug, version || null, taskId);
  if (!task) return res.status(404).json({ error: 'Not found' });

  const resolved = resolveAttachment(task, attId);
  if (!resolved) return res.status(404).json({ error: 'Not found' });

  // Attachment bytes never change once uploaded — a new upload gets a new id — so
  // a content hash is a stable, correct validator.
  const etag = `"${crypto.createHash('sha1').update(resolved.buf).digest('base64url')}"`;

  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.setHeader('Content-Type', resolved.contentType);
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.headers['if-none-match'] === etag) return res.status(304).end();

  res.setHeader('Content-Length', String(resolved.buf.length));
  if (req.method === 'HEAD') return res.status(200).end();
  return res.status(200).send(resolved.buf);
}
