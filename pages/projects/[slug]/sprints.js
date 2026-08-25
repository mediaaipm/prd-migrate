import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import Nav from '../../../components/Nav'
import SprintAnalytics from '../../../components/SprintAnalytics'
import { apiFetch } from '../../../lib/api-fetch'

export default function ProjectSprints({ currentUser }) {
  const router = useRouter()
  const { slug, sprint } = router.query
  const [projectName, setProjectName] = useState('')

  // Breadcrumb only — the analytics component owns its own loading and error
  // states, so a slow project fetch must not hold the page back.
  useEffect(() => {
    if (!router.isReady || !slug) return
    apiFetch(`/api/projects/${slug}`)
      .then(r => (r.ok ? r.json() : null))
      .then(p => { if (p) setProjectName(p.name || '') })
      .catch(() => {})
  }, [router.isReady, slug])

  // The chosen sprint lives in the URL so the view is linkable and the back
  // button steps through it. `shallow` keeps the page from re-running data
  // fetching it does not have.
  function handleSprintChange(id) {
    if (!slug) return
    const href = id ? `/projects/${slug}/sprints?sprint=${encodeURIComponent(id)}` : `/projects/${slug}/sprints`
    router.replace(href, undefined, { shallow: true })
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
              Burndown, velocity, team throughput and the holidays that shape the working days.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link href={`/projects/${slug}/tasks`} className="btn-ghost" style={{ fontSize: 13, padding: '6px 14px', textDecoration: 'none' }}>Tasks</Link>
            <Link href={`/projects/${slug}/dashboard`} className="btn-ghost" style={{ fontSize: 13, padding: '6px 14px', textDecoration: 'none' }}>Dashboard</Link>
            <Link href={`/projects/${slug}`} className="btn-ghost" style={{ fontSize: 13, padding: '6px 14px', textDecoration: 'none' }}>← Back to Project</Link>
          </div>
        </div>

        <div className="section-card" style={{ marginTop: 16 }}>
          <SprintAnalytics
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
