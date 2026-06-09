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

  useEffect(() => {
    try {
      const raw = localStorage.getItem('ss_auth')
      if (!raw) return
      if (raw === '1') setCurrentUser({ name: 'Admin', username: 'admin' })
      else setCurrentUser(JSON.parse(raw))
    } catch {}
  }, [])

  useEffect(() => {
    setMenuOpen(false)
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
