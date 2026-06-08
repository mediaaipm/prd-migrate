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

  useEffect(() => {
    try {
      const raw = localStorage.getItem('ss_auth')
      if (!raw) return
      if (raw === '1') setCurrentUser({ name: 'Admin', username: 'admin' })
      else setCurrentUser(JSON.parse(raw))
    } catch {}
  }, [])

  async function handleSignOut() {
    try { await apiFetch('/api/auth/logout', { method: 'POST' }) } catch {}
    localStorage.removeItem('ss_auth')
    router.reload()
  }

  return (
    <nav className="nav">
      <div className="nav-brand">
        <Image src="https://www.sanatansansaar.com/Bird.png" alt="Sanatan Sansaar" width={32} height={32} className="nav-logo" unoptimized />
        <span>Sanatan Sansaar</span> Projects PRD
      </div>
      <div className="nav-links">
        <Link href="/" className={`nav-link${pathname === '/' || pathname.startsWith('/projects') ? ' active' : ''}`}>Projects</Link>
        <Link href="/dashboard" className={`nav-link${pathname === '/dashboard' ? ' active' : ''}`}>Dashboard</Link>
        {projectSlug && (
          <Link href={`/projects/${projectSlug}/dashboard`} className={`nav-link${pathname.endsWith('/dashboard') && pathname.startsWith('/projects') ? ' active' : ''}`}>
            Project Dashboard
          </Link>
        )}
        <a href="/graphify/graph.html" target="_blank" rel="noreferrer" className="nav-link">Graph</a>
        <Link href="/admin" className={`nav-link${pathname === '/admin' ? ' active' : ''}`}>Admin</Link>
        {currentUser && (
          <span className="nav-user" title={currentUser.username}>
            {currentUser.name || currentUser.username}
          </span>
        )}
        <button onClick={handleSignOut} className="nav-link nav-signout">Sign out</button>
      </div>
    </nav>
  )
}
