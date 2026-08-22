const { getTask } = require('../../../../../../lib/task-store');
const { requirePermission, requireProjectAccess } = require('../../../../../../lib/require-permission');
const { loadAttachment, readAttachmentKey } = require('../../../../../../lib/task-media');
const { withCpuLog } = require('../../../../../../lib/cpu-log');

// The stored content type is whatever the uploader's data URL claimed — the client
// picks it, so it is attacker-controlled. Echoing it back means a `text/html` or
// `image/svg+xml` upload becomes a document on THIS origin, and SVG executes script,
// which is stored XSS against every viewer's session. `nosniff` does not help: it
// stops sniffing, not an explicit type.
//
// So only raster types the browser cannot be tricked into treating as a document are
// served inline. Anything else — svg, pdf, html, office files — keeps working as an
// attachment, but as an octet-stream download that never renders in place.
const INLINE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
]);

// The filename reaches a response header, so a raw CR/LF in it would let the
// uploader inject one. RFC 5987's filename* is percent-encoded, which escapes
// every such character for free — no separate sanitiser to get wrong.
function contentDisposition(name) {
  return `attachment; filename*=UTF-8''${encodeURIComponent(String(name || 'download'))}`;
}

// Serves the bytes for one attachment. Task lists now carry a `url` pointing here
// instead of an inline data URL, which is the whole point: this response is
// individually cacheable and revalidates cheaply, where a base64 blob buried in a
// JSON list response could never be cached at all.
//
// Cache-Control is `private` — these sit behind a per-project ACL, so they must
// not land in a shared edge cache. The browser cache is where the saving is: the
// same board reload previously re-downloaded every image, every time.
async function handler(req, res) {
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
  // With `immutable` the browser does not revalidate at all, so this response has no
  // use for an ETag — and Next's is actively expensive.
  //
  // `res.send(buffer)` must NOT be used here. Next's sendData() treats anything whose
  // `typeof` is 'object' as JSON-like, and a Buffer is an object, so it runs
  // JSON.stringify(buf) — expanding a 200 KB image into ~900 KB of
  // `{"type":"Buffer","data":[137,80,...]}` — then walks every character of that with
  // an FNV-1a hash in JS to build an ETag, and finally throws the whole thing away and
  // writes the raw buffer anyway. Every image paid for it.
  //
  // res.end() is the raw node method (Next only wraps it to count bytes), so going
  // straight there skips the stringify and the hash entirely.
  const inline = INLINE_TYPES.has(resolved.contentType);

  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.setHeader('Content-Type', inline ? resolved.contentType : 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Belt and braces: if this URL is navigated to directly it becomes a document, and
  // `sandbox` strips it of script, forms and same-origin privileges even then.
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  if (!inline) res.setHeader('Content-Disposition', contentDisposition(resolved.name));
  res.setHeader('Content-Length', String(resolved.buf.length));

  res.statusCode = 200;
  if (req.method === 'HEAD') return res.end();
  return res.end(resolved.buf);
}

export default withCpuLog(handler, '/api/projects/[slug]/media/[taskId]/[attId]');
