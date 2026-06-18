import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import Image from 'next/image'
import { apiFetch } from '../lib/api-fetch'

export default function Nav() {
  const router = useRouter()
  const { pathname, query } = router
  const projectSlug = query.slug || (pathname.match(/^\/projects\/([^/]+)/) || [])[1]
  const [currentUser, setCurrentUser] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [notifs, setNotifs] = useState([])
  const [showNotifs, setShowNotifs] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem('ss_auth')
      if (!raw) return
      if (raw === '1') setCurrentUser({ name: 'Admin', username: 'admin' })
      else setCurrentUser(JSON.parse(raw))
    } catch {}
  }, [])

  // Poll notifications (no websockets — matches the app's stateless model).
  useEffect(() => {
    let alive = true
    function load() {
      apiFetch('/api/notifications')
        .then(r => r.ok ? r.json() : [])
        .then(d => { if (alive) setNotifs(Array.isArray(d) ? d : []) })
        .catch(() => {})
    }
    load()
    const t = setInterval(load, 60000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  const unread = notifs.filter(n => !n.read).length

  async function openNotif(n) {
    setShowNotifs(false)
    if (!n.read) {
      setNotifs(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x))
      apiFetch(`/api/notifications/${n.id}`, { method: 'PATCH' }).catch(() => {})
    }
    if (n.link) router.push(n.link)
  }

  async function markAllRead() {
    setNotifs(prev => prev.map(x => ({ ...x, read: true })))
    apiFetch('/api/notifications', { method: 'POST' }).catch(() => {})
  }

  useEffect(() => {
    setMenuOpen(false)
    setShowNotifs(false)
  }, [pathname])

  async function handleSignOut() {
    try { await apiFetch('/api/auth/logout', { method: 'POST' }) } catch {}
    localStorage.removeItem('ss_auth')
    router.reload()
  }

  const links = (
    <>
      <Link href="/" className={`nav-link${pathname === '/' || pathname.startsWith('/projects') ? ' active' : ''}`} onClick={() => setMenuOpen(false)}>Projects</Link>
      <Link href="/dashboard" className={`nav-link${pathname === '/dashboard' ? ' active' : ''}`} onClick={() => setMenuOpen(false)}>Dashboard</Link>
      {projectSlug && (
        <Link href={`/projects/${projectSlug}/dashboard`} className={`nav-link${pathname.endsWith('/dashboard') && pathname.startsWith('/projects') ? ' active' : ''}`} onClick={() => setMenuOpen(false)}>
          Project Dashboard
        </Link>
      )}
      <a href="/graphify/graph.html" target="_blank" rel="noreferrer" className="nav-link">Graph</a>
      <Link href="/admin" className={`nav-link${pathname === '/admin' ? ' active' : ''}`} onClick={() => setMenuOpen(false)}>Admin</Link>
      <div className="nav-notif">
        <button className="nav-notif-bell" onClick={() => setShowNotifs(v => !v)} title="Notifications" aria-label="Notifications">
          🔔
          {unread > 0 && <span className="nav-notif-badge">{unread > 9 ? '9+' : unread}</span>}
        </button>
        {showNotifs && (
          <div className="nav-notif-dropdown">
            <div className="nav-notif-head">
              <span>Notifications</span>
              {unread > 0 && <button className="btn-ghost" style={{ fontSize: 11 }} onClick={markAllRead}>Mark all read</button>}
            </div>
            <div className="nav-notif-list">
              {notifs.length === 0 ? (
                <div className="nav-notif-empty">No notifications</div>
              ) : (
                notifs.map(n => (
                  <button key={n.id} className={`nav-notif-item${n.read ? '' : ' unread'}`} onClick={() => openNotif(n)}>
                    <div className="nav-notif-text">{n.text}</div>
                    <div className="nav-notif-time">{new Date(n.createdAt).toLocaleString()}</div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
      {currentUser && (
        <span className="nav-user" title={currentUser.username}>
          {currentUser.name || currentUser.username}
        </span>
      )}
      <button onClick={handleSignOut} className="nav-link nav-signout">Sign out</button>
    </>
  )

  return (
    <>
      <nav className="nav">
        <div className="nav-brand">
          <Image src="https://www.sanatansansaar.com/Bird.png" alt="Sanatan Sansaar" width={32} height={32} className="nav-logo" unoptimized />
          <span>Sanatan Sansaar</span> Projects PRD
        </div>
        <div className="nav-links nav-links--desktop">
          {links}
        </div>
        <button
          className="nav-hamburger"
          onClick={() => setMenuOpen(v => !v)}
          aria-label="Toggle menu"
          aria-expanded={menuOpen}
        >
          <span className={`nav-hamburger-icon${menuOpen ? ' open' : ''}`} />
        </button>
      </nav>
      {menuOpen && (
        <div className="nav-mobile-overlay" onClick={() => setMenuOpen(false)} />
      )}
      <div className={`nav-mobile-drawer${menuOpen ? ' open' : ''}`}>
        {links}
      </div>
    </>
  )
}
