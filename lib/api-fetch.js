// Browser-only fetch wrapper that attaches the current user as X-User header
export function apiFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) }
  try {
    const raw = localStorage.getItem('ss_auth')
    if (raw === '1') {
      headers['X-User'] = JSON.stringify({ name: 'Admin', username: 'admin', isAdmin: true, role: 'superadmin' })
    } else if (raw) {
      try {
        const parsed = JSON.parse(raw)
        // Upgrade stale sessions: no role or old 'admin' role on the built-in superadmin account
        if (parsed.isAdmin === true && (!parsed.role || (parsed.username === 'admin' && parsed.role !== 'superadmin'))) {
          parsed.role = 'superadmin'
        }
        headers['X-User'] = JSON.stringify(parsed)
      } catch {
        headers['X-User'] = raw
      }
    }
  } catch {}
  return fetch(url, { ...options, headers })
}

export async function apiFetchOrLogout(url, options = {}) {
  const res = await apiFetch(url, options)
  if (res.status === 403) {
    try { localStorage.removeItem('ss_auth') } catch {}
    window.location.reload()
    return res
  }
  return res
}
