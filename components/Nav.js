import { useState, useEffect } from 'react'
import { roleLabel as roleName } from '../lib/roles'
import Link from 'next/link'
import { useRouter } from '../lib/router-compat'
import Image from 'next/image'
import { apiFetch } from '../lib/api-fetch'
import { isSuperAdmin, canView, hasPerm } from '../lib/client-permissions'
import { useTheme, THEMES } from '../lib/theme'
import { enqueue } from '../lib/submit-queue'
import { useQueueState, LEAVE_WARNING } from '../lib/use-submit-queue'
import { Bell, BookOpen, Check, ChevronDown, LogOut, Monitor, Palette, Gauge } from 'lucide-react'
import { Button } from './ui/button'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from './ui/dropdown-menu'
import { profileHref } from './PersonLink'

const CHIME_URL = 'https://cdn.pixabay.com/download/audio/2025/05/06/audio_2fd68b9a9a.mp3?filename=alexis_gaming_cam-bell-notification-337658.mp3'

// Two rows, two jobs:
//   the top bar is global — Projects, then theme / notifications / you
//   the project bar appears inside a project — where you are, and its sections as tabs
// Pages no longer repeat these links as header buttons; their header holds only the
// page's own actions.

// Project names, remembered per tab so the project bar shows the name immediately on
// every section switch instead of flashing the slug until the page's own fetch lands.
const NAME_CACHE_KEY = 'ss_project_names'
function cachedName(slug) {
  try { return JSON.parse(sessionStorage.getItem(NAME_CACHE_KEY) || '{}')[slug] || '' } catch { return '' }
}
function rememberName(slug, name) {
  try {
    const all = JSON.parse(sessionStorage.getItem(NAME_CACHE_KEY) || '{}')
    if (all[slug] === name) return
    sessionStorage.setItem(NAME_CACHE_KEY, JSON.stringify({ ...all, [slug]: name }))
  } catch {}
}

// Every page renders its own <Nav>, so it remounts on each section switch. What must
// survive that lives here, per tab: the last notification list (a switch inside
// NOTIF_FRESH_MS reuses it instead of costing an invocation) and which ids have already
// chimed (so the chime plays once per new notification, not once per page).
const NOTIF_FRESH_MS = 60000
const notifState = { at: 0, list: null, seen: null }

function projectTabs(slug, user) {
  const base = `/projects/${slug}`
  return [
    { key: 'tasks', label: 'Tasks', href: `${base}/tasks`, show: canView(user, 'task') },
    { key: 'backlog', label: 'Backlog', href: `${base}/backlog`, show: canView(user, 'task') },
    { key: 'sprints', label: 'Sprints', href: `${base}/sprints`, show: canView(user, 'sprint') },
    { key: 'qa', label: 'QA Review', href: `${base}/qa`, show: canView(user, 'task') },
    { key: 'epics', label: 'Epics', href: `${base}/epics`, show: canView(user, 'task') },
    { key: 'prd', label: 'Project Version', href: base, show: canView(user, 'version') || canView(user, 'proposal') },
    { key: 'insights', label: 'Insights', href: `${base}/dashboard`, show: canView(user, 'dashboard') },
  ].filter(t => t.show)
}

function activeTab(pathname, slug) {
  const base = `/projects/${slug}`
  for (const k of ['tasks', 'backlog', 'sprints', 'qa', 'epics']) if (pathname === `${base}/${k}`) return k
  if (pathname === `${base}/dashboard`) return 'insights'
  if (pathname === base || pathname === `${base}/diff` || pathname === '/editor') return 'prd'
  return ''
}

export default function Nav({ projectName }) {
  const router = useRouter()
  const { pathname, query } = router
  const { pending } = useQueueState()
  const { meta: themeMeta, setTheme: pickTheme, isSystem, followSystem } = useTheme()
  const projectSlug = query.slug || (pathname.match(/^\/projects\/([^/]+)/) || [])[1]
  const [currentUser, setCurrentUser] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [notifs, setNotifsState] = useState(() => notifState.list || [])
  const setNotifs = upd => setNotifsState(prev => {
    const next = typeof upd === 'function' ? upd(prev) : upd
    notifState.list = next
    return next
  })
  const [showNotifs, setShowNotifs] = useState(false)
  const [shownName, setShownName] = useState('')

  useEffect(() => {
    if (!projectSlug) return
    if (projectName) { rememberName(projectSlug, projectName); setShownName(projectName) }
    else setShownName(cachedName(projectSlug))
  }, [projectSlug, projectName])

  function playChime() {
    try {
      const a = new Audio(CHIME_URL)
      a.volume = 0.5
      a.play().catch(() => {}) // browsers may block autoplay before user interaction — best effort
    } catch {}
  }

  useEffect(() => {
    try {
      const raw = localStorage.getItem('ss_auth')
      if (!raw) return
      if (raw === '1') setCurrentUser({ name: 'Admin', username: 'admin', isAdmin: true, role: 'superadmin' })
      else setCurrentUser(JSON.parse(raw))
    } catch {}
  }, [])

  // Poll notifications (no websockets — matches the app's stateless model).
  //
  // Only while the tab is actually being looked at. A backgrounded tab left open
  // overnight used to keep firing once a minute — 60 function invocations an hour,
  // per tab, per user, to update a badge nobody could see. That, not real usage,
  // is what a serverless invocation quota gets spent on.
  //
  // The interval is 5 minutes, not 1. At the app's real traffic (~740 function
  // invocations a day) a single visible tab polling once a minute for an 8-hour
  // day was ~480 of them — roughly two thirds of everything the account spent,
  // to refresh a badge. Notifications are not time-critical enough to justify
  // that; anything that is arrives on the next page navigation anyway.
  useEffect(() => {
    const POLL_MS = 300000
    let alive = true
    function load() {
      notifState.at = Date.now()
      apiFetch('/api/notifications')
        .then(r => r.ok ? r.json() : [])
        .then(d => {
          if (!alive) return
          const arr = Array.isArray(d) ? d : []
          setNotifs(arr)
          // Chime on login (first load w/ unread) and whenever a new unread arrives (e.g. 4h delay reminder).
          const unreadIds = arr.filter(n => !n.read).map(n => n.id)
          const firstLoad = notifState.seen === null
          const hasNew = firstLoad ? unreadIds.length > 0 : unreadIds.some(id => !notifState.seen.has(id))
          notifState.seen = new Set(arr.map(n => n.id))
          if (hasNew) playChime()
        })
        .catch(() => {})
    }

    function tick() {
      if (typeof document !== 'undefined' && document.hidden) return
      load()
    }

    // Coming back to a tab should feel current, but a quick tab-flick must not
    // fire a request each time.
    function onVisible() {
      if (document.hidden) return
      if (Date.now() - notifState.at >= POLL_MS) load()
    }

    if (Date.now() - notifState.at >= NOTIF_FRESH_MS) load()
    const t = setInterval(tick, POLL_MS)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const unread = notifs.filter(n => !n.read).length

  function openNotif(n) {
    setShowNotifs(false)
    if (!n.read) {
      setNotifs(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x))
      enqueue({ url: `/api/notifications/${n.id}`, method: 'PATCH', label: 'Mark notification read', silent: true })
    }
    if (n.link) router.push(n.link)
  }

  function markAllRead() {
    setNotifs(prev => prev.map(x => ({ ...x, read: true })))
    enqueue({ url: '/api/notifications', method: 'POST', label: 'Mark all notifications read', silent: true })
  }

  useEffect(() => {
    setMenuOpen(false)
    setShowNotifs(false)
    setUserMenuOpen(false)
  }, [pathname])

  // Not queued, and blocked while the queue is draining: signing out clears the
  // session cookie, so every queued write would then be sent unauthenticated, get
  // a 401, and park.
  async function handleSignOut() {
    if (pending > 0) {
      alert(LEAVE_WARNING)
      return
    }
    try { await apiFetch('/api/auth/logout', { method: 'POST' }) } catch {}
    localStorage.removeItem('ss_auth')
    router.reload()
  }

  // Managers (and anyone else holding assignee:manage) get the Admin page too — its
  // Users tab only (views/admin.js).
  const isAdminUser = !!(currentUser?.isAdmin || currentUser?.role === 'admin' || hasPerm(currentUser, 'assignee:manage'))
  const displayName = currentUser ? (currentUser.name || currentUser.username) : ''
  const roleLabel = isSuperAdmin(currentUser) ? 'Super admin' : roleName(currentUser?.role)

  const globalLinks = (
    <>
      {canView(currentUser, 'project') && (
        <Link href="/" className={`nav-link${pathname === '/' || pathname.startsWith('/projects') ? ' active' : ''}`} onClick={() => setMenuOpen(false)}>Projects</Link>
      )}
      {currentUser && (
        <Link href="/my-tasks" className={`nav-link${pathname === '/my-tasks' ? ' active' : ''}`} onClick={() => setMenuOpen(false)}>My tasks</Link>
      )}
      {(['manager', 'teamlead', 'designlead', 'admin', 'superadmin'].includes(currentUser?.role) || currentUser?.isAdmin) && (
        <Link href="/teams" className={`nav-link${pathname === '/teams' ? ' active' : ''}`} onClick={() => setMenuOpen(false)}>Teams</Link>
      )}
    </>
  )

  const adminLinks = (
    <>
      {isAdminUser && (
        <Link href="/admin" className={`nav-menu-item${pathname === '/admin' ? ' active' : ''}`} onClick={() => { setMenuOpen(false); setUserMenuOpen(false) }}>Admin</Link>
      )}
      {isSuperAdmin(currentUser) && (
        <Link href="/settings/roles" className={`nav-menu-item${pathname === '/settings/roles' ? ' active' : ''}`} onClick={() => { setMenuOpen(false); setUserMenuOpen(false) }}>Access control</Link>
      )}
    </>
  )

  const tabs = projectSlug ? projectTabs(projectSlug, currentUser) : []
  const current = projectSlug ? activeTab(pathname, projectSlug) : ''

  return (
    <>
      <nav className="nav">
        <Link href="/" className="nav-brand" aria-label="Projects home">
          <Image src="/bird.png" alt="" width={28} height={28} className="nav-logo" unoptimized />
          <span className="nav-brand-name"><span>Sanatan Sansaar</span> Task Manager</span>
        </Link>
        <div className="nav-links nav-links--desktop">{globalLinks}</div>

        <div className="nav-tools">
          {/* Theme picker: every theme with a live swatch, grouped light / dark, plus
              "Match system". Colours come from lib/theme-registry.js. */}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="nav-tool-btn" title={`Theme: ${isSystem ? `System (${themeMeta.label})` : themeMeta.label}`} aria-label={`Theme: ${themeMeta.label}. Choose a theme`}>
                <Palette />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 p-1.5">
              <DropdownMenuItem onSelect={() => followSystem()} className="gap-3 py-2">
                <span className="theme-swatch theme-swatch--system" aria-hidden="true"><Monitor /></span>
                <span className="flex flex-col">
                  <span className="text-sm font-medium">Match system</span>
                  <span className="text-xs text-muted-foreground">Light or Dark, following your device</span>
                </span>
                {isSystem && <Check className="ml-auto" />}
              </DropdownMenuItem>
              {['light', 'dark'].map(mode => (
                <div key={mode}>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">{mode === 'light' ? 'Light themes' : 'Dark themes'}</DropdownMenuLabel>
                  {THEMES.filter(t => t.mode === mode).map(t => (
                    <DropdownMenuItem key={t.id} onSelect={() => pickTheme(t.id)} className="gap-3 py-1.5">
                      <span className="theme-swatch" aria-hidden="true" style={{ '--sw-bg': t.swatch.bg, '--sw-card': t.swatch.card, '--sw-accent': t.swatch.accent, '--sw-text': t.swatch.text }}>
                        <span className="theme-swatch-card"><i /><b /></span>
                      </span>
                      <span className="flex flex-col">
                        <span className="text-sm font-medium">{t.label}</span>
                        <span className="text-xs text-muted-foreground">{t.blurb}</span>
                      </span>
                      {!isSystem && themeMeta.id === t.id && <Check className="ml-auto" />}
                    </DropdownMenuItem>
                  ))}
                </div>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu open={showNotifs} onOpenChange={setShowNotifs} modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="nav-tool-btn relative" title="Notifications" aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}>
                <Bell />
                {unread > 0 && <span className="nav-notif-badge">{unread > 9 ? '9+' : unread}</span>}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80 p-0">
              <div className="nav-notif-head">
                <span>Notifications</span>
                {unread > 0 && <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={markAllRead}>Mark all read</Button>}
              </div>
              <div className="nav-notif-list">
                {notifs.length === 0 ? (
                  <div className="nav-notif-empty">No notifications</div>
                ) : (
                  notifs.map(n => (
                    <DropdownMenuItem key={n.id} className={`nav-notif-item${n.read ? '' : ' unread'} flex-col items-start gap-0.5 rounded-none px-3 py-2.5`} onSelect={() => openNotif(n)}>
                      <div className="nav-notif-text">{n.text}</div>
                      <div className="nav-notif-time">{new Date(n.createdAt).toLocaleString()}</div>
                    </DropdownMenuItem>
                  ))
                )}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Sits just before the profile. In the
              mobile drawer it is an ordinary link. */}
          {currentUser && (
            <Link href="/guide" className={`nav-guide-btn nav-desktop-only${pathname === '/guide' ? ' active' : ''}`}>
              <BookOpen aria-hidden="true" />
              Guide
            </Link>
          )}

          {currentUser && (
            <div className="nav-desktop-only">
            <DropdownMenu open={userMenuOpen} onOpenChange={setUserMenuOpen} modal={false}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="nav-user-btn h-9 gap-2 pl-1 pr-2" title={currentUser.username}>
                  <span className="nav-avatar" aria-hidden="true">{displayName.charAt(0).toUpperCase()}</span>
                  <span className="nav-user-name">{displayName}</span>
                  <ChevronDown className="opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="flex flex-col gap-0.5">
                  <span className="truncate">{displayName}</span>
                  <span className="text-xs font-normal text-muted-foreground">{roleLabel}</span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {currentUser?.name && (
                  <DropdownMenuItem asChild><Link href={profileHref(currentUser.name)}><Gauge />My performance</Link></DropdownMenuItem>
                )}
                {isAdminUser && (
                  <DropdownMenuItem asChild><Link href="/admin">Admin</Link></DropdownMenuItem>
                )}
                {isSuperAdmin(currentUser) && (
                  <DropdownMenuItem asChild><Link href="/settings/roles">Access control</Link></DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={handleSignOut}><LogOut />Sign out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            </div>
          )}

          <button
            className="nav-hamburger"
            onClick={() => setMenuOpen(v => !v)}
            aria-label="Toggle menu"
            aria-expanded={menuOpen}
          >
            <span className={`nav-hamburger-icon${menuOpen ? ' open' : ''}`} />
          </button>
        </div>
      </nav>

      {projectSlug && (
        <div className="project-bar">
          <div className="project-bar-crumb">
            <Link href="/">Projects</Link>
            <span aria-hidden="true">›</span>
            <strong title={shownName || projectSlug}>{shownName || projectSlug}</strong>
          </div>
          <nav className="project-tabs" aria-label="Project sections">
            {tabs.map(t => (
              <Link key={t.key} href={t.href} className={`project-tab${current === t.key ? ' active' : ''}`} aria-current={current === t.key ? 'page' : undefined}>
                {t.label}
              </Link>
            ))}
          </nav>
        </div>
      )}

      {menuOpen && (
        <div className="nav-mobile-overlay" onClick={() => setMenuOpen(false)} />
      )}
      <div className={`nav-mobile-drawer${menuOpen ? ' open' : ''}`}>
        {currentUser && (
          <div className="nav-menu-head nav-menu-head--drawer">
            <strong>{displayName}</strong>
            <span>{roleLabel}</span>
          </div>
        )}
        {currentUser && (
          <Link href="/guide" className={`nav-link${pathname === '/guide' ? ' active' : ''}`} onClick={() => setMenuOpen(false)}>Guide</Link>
        )}
        {globalLinks}
        {currentUser?.name && (
          <Link href={profileHref(currentUser.name)} className={`nav-link${pathname === profileHref(currentUser.name) ? ' active' : ''}`} onClick={() => setMenuOpen(false)}>My performance</Link>
        )}
        {adminLinks}
        <button onClick={handleSignOut} className="nav-link nav-signout">Sign out</button>
      </div>
    </>
  )
}
