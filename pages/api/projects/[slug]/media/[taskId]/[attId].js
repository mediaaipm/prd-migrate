const { getTask } = require('../../../../../../lib/task-store');
const { requirePermission, requireProjectAccess } = require('../../../../../../lib/require-permission');
const { loadAttachment, readAttachmentKey } = require('../../../../../../lib/task-media');

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

  // Fast path: bytes come from their own key. This route used to load the project's
  // ENTIRE task list — ~500 KB, parsed — to serve a single image, which meant a board
  // with 20 pictures read 10 MB out of redis just to draw itself.
  let resolved = await readAttachmentKey(slug, version || null, taskId, attId);

  // Slow path: a record written before the offload still carries its bytes inline, so
  // the task itself is the only place to find them.
  if (!resolved) {
    const task = await getTask(slug, version || null, taskId);
    if (!task) return res.status(404).json({ error: 'Not found' });
    resolved = await loadAttachment(slug, version || null, task, attId);
  }
  if (!resolved) return res.status(404).json({ error: 'Not found' });

  // Attachment bytes never change once uploaded — a new upload gets a new id — so a
  // year of immutable browser caching is safe, and it is what does the real work here.
  //
  // The ETag is Next's: it hashes the body of every pages-API response and answers 304
  // itself. This route used to compute its own sha1 and compare `If-None-Match` against
  // it, which could never match — Next had already replaced the value the client was
  // given — so the hand-rolled 304 was dead code that only cost a hash of every image.
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.setHeader('Content-Type', resolved.contentType);
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'HEAD') {
    res.setHeader('Content-Length', String(resolved.buf.length));
    return res.status(200).end();
  }
  return res.status(200).send(resolved.buf);
}
