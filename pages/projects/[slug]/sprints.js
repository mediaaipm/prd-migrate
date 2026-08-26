import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import Nav from '../../../components/Nav'
import SprintAnalytics from '../../../components/SprintAnalytics'
import SprintsSection from '../../../components/SprintsSection'
import { apiFetch } from '../../../lib/api-fetch'
import { useOptimistic } from '../../../lib/optimistic'
import { onSync } from '../../../lib/submit-queue'
import { scopeUserToProject } from '../../../lib/scoped-user'

export default function ProjectSprints({ currentUser }) {
  const router = useRouter()
  const { slug, sprint } = router.query
  const [projectName, setProjectName] = useState('')
  // Fed to the sprint board so it offers only the moves the server will accept:
  // `taskAcl` is the project's per-assignee status rule, `access` its role policy.
  const [taskAcl, setTaskAcl] = useState(null)
  const [taskPrefix, setTaskPrefix] = useState('')
  const [access, setAccess] = useState(null)

  // The sprint modal picks tasks out of this list, so the page owns the fetch that
  // used to live on the Tasks page. Same optimistic scope as the Tasks page uses, so a
  // card created there and still in flight is already visible here.
  const [serverTasks, setServerTasks] = useState([])
  const tasksApi = slug ? `/api/projects/${slug}/tasks` : null
  const tasks = useOptimistic(serverTasks, { entity: 'task', scope: tasksApi, cascade: true })

  // Bumped whenever a sprint is saved, started, completed or deleted. It remounts both
  // halves of the page: the list reloads, and the analytics below it recompute against
  // the new sprint set instead of showing a burndown for a sprint that just ended.
  const [sprintKey, setSprintKey] = useState(0)
  const [newSprintTrigger, setNewSprintTrigger] = useState(0)
  // Sprint banners render the task chips the sprint API embeds, so a task that changed
  // status elsewhere has to poke the list to refetch — the Tasks page did the same.
  const [tasksVersion, setTasksVersion] = useState(0)

  const loadTasks = useCallback(() => {
    if (!tasksApi) return Promise.resolve()
    return apiFetch(tasksApi)
      .then(r => (r.ok ? r.json() : null))
      // A failed GET means "unknown", not "empty" — keep what we have.
      .then(data => { if (Array.isArray(data)) { setServerTasks(data); setTasksVersion(n => n + 1) } })
      .catch(() => {})
  }, [tasksApi])

  useEffect(() => { loadTasks() }, [loadTasks])
  useEffect(() => onSync(item => {
    if (item.optimistic?.entity === 'task') return loadTasks()
  }), [loadTasks])

  // Breadcrumb only — the analytics component owns its own loading and error
  // states, so a slow project fetch must not hold the page back.
  useEffect(() => {
    if (!router.isReady || !slug) return
    apiFetch(`/api/projects/${slug}`)
      .then(r => (r.ok ? r.json() : null))
      .then(p => {
        if (!p) return
        setProjectName(p.name || '')
        setTaskAcl(p.taskAcl || null)
        setTaskPrefix(p.taskPrefix || '')
      })
      .catch(() => {})
  }, [router.isReady, slug])

  // This project's effective role policy — same overlay the Tasks page applies.
  useEffect(() => {
    if (!router.isReady || !slug) return
    apiFetch(`/api/projects/${slug}/access`)
      .then(r => (r.ok ? r.json() : null))
      .then(a => setAccess(a))
      .catch(() => {})
  }, [router.isReady, slug])

  const scopedUser = useMemo(() => scopeUserToProject(currentUser, access), [currentUser, access])

  // The chosen sprint lives in the URL so the view is linkable and the back
  // button steps through it. `shallow` keeps the page from re-running data
  // fetching it does not have.
  function handleSprintChange(id) {
    if (!slug) return
    const href = id ? `/projects/${slug}/sprints?sprint=${encodeURIComponent(id)}` : `/projects/${slug}/sprints`
    router.replace(href, undefined, { shallow: true })
  }

  // "Analytics" on a sprint banner now points at the panel further down this same page
  // rather than at another route, so it selects the sprint and walks the eye there.
  function focusAnalytics(id) {
    handleSprintChange(id)
    if (typeof document !== 'undefined') {
      document.getElementById('sprint-analytics')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  if (!router.isReady) {
    return (
      <>
        <Nav />
        <main className="page page--full">
          <div className="page-header">
            <span className="skeleton" style={{ width: 240, height: 12, marginBottom: 10, display: 'block' }} />
            <span className="skeleton" style={{ width: 200, height: 26, display: 'block' }} />
          </div>
          <div className="section-card" style={{ marginTop: 16 }}>
            <div className="section-card-header"><span className="skeleton" style={{ width: 120, height: 13 }} /></div>
            <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
              {[0, 1, 2, 3].map(i => <span key={i} className="skeleton" style={{ height: 96, borderRadius: 12 }} />)}
            </div>
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      <Nav />
      <main className="page page--full">
        <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 4 }}>
              <Link href="/">Projects</Link> / <Link href={`/projects/${slug}`}>{projectName || slug}</Link> / Sprints
            </div>
            <h1 style={{ marginBottom: 4 }}>{projectName || slug} — Sprints</h1>
            <p style={{ color: 'var(--muted)', fontSize: 14, margin: 0 }}>
              Plan, run and close sprints — with burndown, velocity, team throughput and the
              holidays that shape the working days.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              onClick={() => setNewSprintTrigger(t => t + 1)}
              style={{
                fontSize: 13, padding: '6px 14px', borderRadius: 8,
                border: '1px solid var(--tint-indigo-fg)', background: 'var(--tint-indigo-fg)',
                color: 'var(--on-accent)', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              + New Sprint
            </button>
            <Link href={`/projects/${slug}/tasks`} className="btn-ghost" style={{ fontSize: 13, padding: '6px 14px', textDecoration: 'none' }}>Tasks</Link>
            <Link href={`/projects/${slug}/dashboard`} className="btn-ghost" style={{ fontSize: 13, padding: '6px 14px', textDecoration: 'none' }}>Dashboard</Link>
            <Link href={`/projects/${slug}`} className="btn-ghost" style={{ fontSize: 13, padding: '6px 14px', textDecoration: 'none' }}>← Back to Project</Link>
          </div>
        </div>

        {slug && (
          <SprintsSection
            key={sprintKey}
            slug={slug}
            tasks={tasks}
            currentUser={scopedUser}
            taskAcl={taskAcl}
            taskPrefix={taskPrefix}
            onSprintChange={() => setSprintKey(k => k + 1)}
            onViewAnalytics={focusAnalytics}
            refreshTrigger={tasksVersion}
            newSprintTrigger={newSprintTrigger}
          />
        )}

        <div className="section-card" id="sprint-analytics" style={{ marginTop: 16 }}>
          <SprintAnalytics
            key={sprintKey}
            slug={slug}
            currentUser={currentUser}
            sprintId={typeof sprint === 'string' ? sprint : undefined}
            onSprintChange={handleSprintChange}
          />
        </div>
      </main>
    </>
  )
}
