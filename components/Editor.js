import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '../lib/api-fetch'

function renderMarkdown(md) {
  return md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^---$/gm, '<hr/>')
    .replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^[\-\*] (.+)$/gm, '<li>$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    .replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>')
    .replace(/^(?!<[hupbco]|<li|<pre)(.+)$/gm, '<p>$1</p>')
}

export default function Editor({ slug, version, proposalId }) {
  const [content, setContent] = useState('')
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setContent('')
    setStatus('')
    if (!slug) return

    const url = proposalId
      ? `/api/projects/${slug}/proposals/${proposalId}`
      : `/api/projects/${slug}/versions/${version}`

    fetch(url)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setContent(data.content || '') })
      .catch(() => {})
  }, [slug, version, proposalId])

  const save = useCallback(async () => {
    setSaving(true)
    setStatus('saving…')
    try {
      const url = proposalId
        ? `/api/projects/${slug}/proposals/${proposalId}`
        : `/api/projects/${slug}/versions/${version}`
      const method = proposalId ? 'PUT' : 'PUT'
      const body = proposalId ? { content } : { content }

      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || JSON.stringify(j))
      setStatus('saved')
    } catch (err) {
      setStatus('error: ' + err.message)
    } finally {
      setSaving(false)
    }
  }, [slug, version, proposalId, content])

  const statusClass = status.startsWith('error') ? 'error' : status === 'saved' ? 'success' : ''

  return (
    <>
      <div className="editor-toolbar" style={{ borderTop: '1px solid var(--border)', borderBottom: 'none', paddingTop: 0, paddingBottom: 0, height: 40, flexShrink: 0 }}>
        <span className={`editor-status ${statusClass}`} style={{ flex: 1 }}>{status}</span>
        <button className="btn-primary" onClick={save} disabled={saving || (!version && !proposalId)}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <div className="editor-panels">
        <div className="editor-panel">
          <div className="panel-label">Markdown</div>
          <textarea
            className="editor-textarea"
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="Start writing your PRD in Markdown…"
            spellCheck={false}
          />
        </div>

        <div className="editor-panel">
          <div className="panel-label">Preview</div>
          <div
            className="md-preview"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
          />
        </div>
      </div>
    </>
  )
}
