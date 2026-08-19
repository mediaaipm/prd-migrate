// Conditional-GET support for the large JSON responses.
//
// The task list is the biggest repeated payload in the app — ~530 KB for a project
// with 900 tasks — and it is re-requested on every board load, version switch, tab
// and reload, mostly for data that has not changed. A conditional GET turns those
// into a bodiless 304.
//
// The ETag itself is NOT set here. Next generates one from the serialized body for
// every pages-API response and answers 304 itself
// (`next/dist/server/api-utils/node/api-resolver.js` → `sendEtagResponse`), and it
// overwrites any ETag the route set first. A hand-rolled validator is therefore
// worse than useless: the client is handed Next's value, sends that back, and the
// route's own comparison never matches — which is exactly how the media route ended
// up with 304 handling that could only ever answer 200.
//
// What Next does NOT set is Cache-Control, and without it a browser has no
// instruction to revalidate at all. That is the missing half, and all this supplies.
//
//   private  — these responses sit behind a per-project ACL and must never land in a
//              shared or CDN cache. Same reasoning as the media route.
//   no-cache — "revalidate before reusing", NOT "don't store". A stale board is worse
//              than a request, so every read still asks; what it saves is the payload.

function sendJsonCached(req, res, payload) {
  res.setHeader('Cache-Control', 'private, no-cache')
  // res.json() sets Content-Type and then routes through res.send(), which is where
  // Next attaches the ETag and short-circuits to 304.
  return res.status(200).json(payload)
}

// The other half: the small, near-static per-project config endpoints (columns,
// categories, labels). A conditional GET saves the payload but still costs the
// invocation, and for a 300-byte column list the invocation *is* the cost — every
// board mount woke a function to be told nothing had changed.
//
// A real max-age means the browser answers repeats itself. Still `private`, for the
// same ACL reason as above: these sit behind requireProjectAccess and must not be
// held in a shared or CDN cache.
//
// The staleness this buys is handled on the client, not here — see lib/config-cache.js.
const CONFIG_MAX_AGE = 60

function sendJsonConfig(res, payload) {
  res.setHeader('Cache-Control', `private, max-age=${CONFIG_MAX_AGE}`)
  return res.status(200).json(payload)
}

module.exports = { sendJsonCached, sendJsonConfig, CONFIG_MAX_AGE }
