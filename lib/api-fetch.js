// Browser-only fetch wrapper.
//
// Authentication rides on the HttpOnly `prd_session` cookie, which the browser
// attaches automatically — `credentials: 'same-origin'` is only spelled out so a
// caller passing its own options can't accidentally drop it. Nothing here sends
// identity in a header any more: the server decides who you are, not the client.
export function apiFetch(url, options = {}) {
  return fetch(url, { credentials: 'same-origin', ...options })
}

export async function apiFetchOrLogout(url, options = {}) {
  const res = await apiFetch(url, options)
  // 401 = the session is gone or expired. 403 = signed in but not allowed, which
  // used to mean "stale identity" under the header scheme; it no longer does, so
  // only 401 forces a sign-out.
  if (res.status === 401) {
    try { localStorage.removeItem('ss_auth') } catch {}
    window.location.reload()
    return res
  }
  return res
}
