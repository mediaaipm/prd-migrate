import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import Nav from '../../../components/Nav'
import { apiFetch } from '../../../lib/api-fetch'

const DiffViewer = dynamic(() => import('../../../components/DiffViewer'), { ssr: false })

export default function DiffPage() {
  const router = useRouter()
  const { slug, left, leftType = 'version', right } = router.query

  const [diffData, setDiffData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [viewMode, setViewMode] = useState('split')
  const [project, setProject] = useState(null)

  // Load project metadata for the selectors
  useEffect(() => {
    if (!router.isReady || !slug) return
    apiFetch(`/api/projects/${slug}`)
      .then(r => r.ok ? r.json() : null)
      .then(setProject)
  }, [router.isReady, slug])

  // Fetch diff when query params are ready
  useEffect(() => {
    if (!router.isReady || !slug || !left || !right) return
    setLoading(true)
    setError('')
    setDiffData(null)
    apiFetch(`/api/projects/${slug}/diff?left=${encodeURIComponent(left)}&leftType=${leftType}&right=${encodeURIComponent(right)}`)
      .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e.error || 'Failed to load diff')))
      .then(data => { setDiffData(data); setLoading(false) })
      .catch(err => { setError(typeof err === 'string' ? err : 'Failed to load diff'); setLoading(false) })
  }, [router.isReady, slug, left, leftType, right])

  function navigate(newLeft, newLeftType, newRight) {
    router.push(
      `/projects/${slug}/diff?left=${encodeURIComponent(newLeft)}&leftType=${newLeftType}&right=${encodeURIComponent(newRight)}`,
      undefined,
      { shallow: true }
    )
  }

  const versions = project?.versions || []
  const proposals = project?.proposals || []

  function handleLeftChange(e) {
    const val = e.target.value
    if (!val || !right) return
    const isProposal = val.startsWith('prop-')
    navigate(val, isProposal ? 'proposal' : 'version', right)
  }

  function handleRightChange(e) {
    const val = e.target.value
    if (!val || !left) return
    navigate(left, leftType, val)
  }

  return (
    <>
      <Nav />
      <main className="page">
        <div className="page-header">
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 4 }}>
            <Link href="/">Projects</Link>
            {project && <> / <Link href={`/projects/${slug}`}>{project.name}</Link></>}
            {' / Compare'}
          </div>
          <h1>Compare</h1>
        </div>

        {/* Selectors */}
        {project && (
          <div className="diff-toolbar" style={{ marginBottom: 0 }}>
            <select
              className="form-input"
              style={{ width: 'auto', minWidth: 200 }}
              value={left || ''}
              onChange={handleLeftChange}
            >
              <option value="" disabled>Select left…</option>
              {versions.length > 0 && (
                <optgroup label="Versions">
                  {versions.map(v => (
                    <option key={v.version} value={v.version}>v{v.version}</option>
                  ))}
                </optgroup>
              )}
              {proposals.length > 0 && (
                <optgroup label="Proposals">
                  {proposals.map(p => (
                    <option key={p.id} value={p.id}>{p.title}</option>
                  ))}
                </optgroup>
              )}
            </select>

            <span className="diff-vs">vs</span>

            <select
              className="form-input"
              style={{ width: 'auto', minWidth: 200 }}
              value={right || ''}
              onChange={handleRightChange}
            >
              <option value="" disabled>Select right…</option>
              {versions.map(v => (
                <option key={v.version} value={v.version}>v{v.version}</option>
              ))}
            </select>

            <div className="diff-mode-toggle" style={{ marginLeft: 'auto' }}>
              <button
                className={`diff-mode-btn${viewMode === 'split' ? ' active' : ''}`}
                onClick={() => setViewMode('split')}
              >
                Split
              </button>
              <button
                className={`diff-mode-btn${viewMode === 'unified' ? ' active' : ''}`}
                onClick={() => setViewMode('unified')}
              >
                Unified
              </button>
            </div>
          </div>
        )}

        {/* Diff labels */}
        {diffData && (
          <div className="diff-toolbar">
            <span className="diff-label-badge">{diffData.left.label}</span>
            <span className="diff-vs">→</span>
            <span className="diff-label-badge">{diffData.right.label}</span>
            {diffData.left.date && (
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                Left: {new Date(diffData.left.date).toLocaleDateString()}
              </span>
            )}
            {diffData.right.date && (
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                Right: {new Date(diffData.right.date).toLocaleDateString()}
              </span>
            )}
          </div>
        )}

        {loading && <div className="empty-state">Loading diff…</div>}
        {error && <div className="empty-state" style={{ color: 'var(--danger)' }}>{error}</div>}
        {!loading && !error && !left && !right && (
          <div className="empty-state">Select two items above to compare.</div>
        )}

        {diffData && (
          <DiffViewer
            leftContent={diffData.left.content}
            rightContent={diffData.right.content}
            leftLabel={diffData.left.label}
            rightLabel={diffData.right.label}
            viewMode={viewMode}
          />
        )}
      </main>
    </>
  )
}
