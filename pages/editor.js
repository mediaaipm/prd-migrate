import dynamic from 'next/dynamic'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import Nav from '../components/Nav'

const Editor = dynamic(() => import('../components/Editor'), { ssr: false })

export default function Page() {
  const router = useRouter()
  const { slug, version, type, id } = router.query

  const isReady = router.isReady
  const isProposal = type === 'proposal'

  return (
    <>
      <Nav />
      {isReady && (
        <div className="editor-shell">
          <aside className="editor-sidebar">
            <div className="sidebar-header">
              {slug ? (
                <Link href={`/projects/${slug}`} style={{ color: 'var(--sidebar-muted)', fontSize: 11 }}>
                  ← {slug}
                </Link>
              ) : 'PRD Editor'}
            </div>
            <div className="sidebar-list">
              {slug && !isProposal && version && (
                <div className="sidebar-item active">v{version}</div>
              )}
              {isProposal && id && (
                <div className="sidebar-item active">Proposal · {id}</div>
              )}
            </div>
          </aside>

          <div className="editor-main">
            <div className="editor-toolbar">
              <span className="editor-path-label">
                {slug ? `${slug}${isProposal ? ` / proposal` : ` / v${version}`}` : ''}
              </span>
            </div>
            {slug && (
              <Editor
                slug={slug}
                version={isProposal ? null : version}
                proposalId={isProposal ? id : null}
              />
            )}
          </div>
        </div>
      )}
    </>
  )
}
