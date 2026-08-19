// Browser-cache busting for the small, near-static per-project config endpoints:
// board columns, task categories and labels.
//
// All three are re-fetched on every board mount and almost never change, which made
// them a large share of the app's function invocations for data the browser already
// had. They now answer `private, max-age=…` (see `sendJsonConfig` in lib/etag.js), so
// a repeat read inside the window is served from the browser cache: no request, no
// invocation, no CPU.
//
// The price of a max-age is staleness, and the one client that must never see it is
// the one that just made the edit — it would reload, be handed its own pre-edit copy
// and write that over the fresh value it had cached in localStorage. A revision token
// in the URL fixes that without weakening the header: after a write the client bumps
// the token, which makes a different URL and therefore a different cache entry, so the
// next read misses and refetches. The token lives in localStorage, so every read after
// that shares the new URL and hits the cache again.
//
// Everyone else still sees up to the max-age of staleness. That is the trade being
// made on purpose: these endpoints carry labels and colours, not task state.

function revKey(ns, slug) {
  return `cfg-rev:${ns}:${slug}`
}

// Call after a successful write, BEFORE any refetch — the refetch is the request that
// has to miss the cache.
export function bumpRev(ns, slug) {
  if (typeof window === 'undefined' || !slug) return
  try { localStorage.setItem(revKey(ns, slug), Date.now().toString(36)) } catch {}
}

export function withRev(url, ns, slug) {
  if (typeof window === 'undefined' || !url || !slug) return url
  let rev = ''
  try { rev = localStorage.getItem(revKey(ns, slug)) || '' } catch {}
  if (!rev) return url
  return `${url}${url.includes('?') ? '&' : '?'}r=${encodeURIComponent(rev)}`
}
