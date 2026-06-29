import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api-fetch'

const ACTION_META = {
  created:        { icon: '✨', verb: 'created this task' },
  updated:        { icon: '✏️', verb: 'updated' },
  commented:      { icon: '💬', verb: 'added a comment' },
  comment_removed:{ icon: '🗑', verb: 'removed a comment' },
  archived:       { icon: '📦', verb: 'archived this task' },
  restored:       { icon: '♻️', verb: 'restored this task' },
}

function actorName(actor) {
  if (!actor) return 'Someone'
  return actor.name || actor.username || 'Someone'
}

function HistoryEntry({ entry }) {
  const meta = ACTION_META[entry.action] || { icon: '•', verb: entry.action }
  const when = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : ''
  return (
    <li className="thist-item">
      <span className="thist-icon" aria-hidden>{meta.icon}</span>
      <div className="thist-body">
        <div className="thist-line">
          <span className="thist-actor">{actorName(entry.actor)}</span>{' '}
          <span className="thist-verb">{meta.verb}</span>
        </div>
        {entry.action === 'updated' && Array.isArray(entry.changes) && (
          <ul className="thist-changes">
            {entry.changes.map((c, i) => (
              <li key={i} className="thist-change">
                <span className="thist-field">{c.label || c.field}</span>{' '}
                <span className="thist-from">{c.from}</span>
                <span className="thist-arrow"> → </span>
                <span className="thist-to">{c.to}</span>
              </li>
            ))}
          </ul>
        )}
        {entry.action === 'commented' && entry.meta?.text && (
          <div className="thist-comment">“{entry.meta.text}”</div>
        )}
        <div className="thist-time">{when}</div>
      </div>
    </li>
  )
}

// Admin-only activity log for a single task. `apiBase` is the tasks collection
// endpoint (e.g. /api/projects/foo/tasks); history lives at `${apiBase}/${task.id}/history`.
export default function TaskHistoryModal({ apiBase, task, label, onClose }) {
  const [history, setHistory] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    setHistory(null); setError('')
    apiFetch(`${apiBase}/${task.id}/history`)
      .then(r => {
        if (r.status === 403) throw new Error('Admin access required to view activity.')
        return r.ok ? r.json() : Promise.reject(new Error('Failed to load activity.'))
      })
      .then(data => { if (live) setHistory(Array.isArray(data) ? data : []) })
      .catch(e => { if (live) setError(e.message || 'Failed to load activity.') })
    return () => { live = false }
  }, [apiBase, task.id])

  return (
    <div className="thist-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="thist-modal">
        <div className="kanban-modal-header">
          <span>Activity{label ? ` — ${label}` : ''}</span>
          <button className="kanban-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="thist-task-title">{task.title}</div>
        <div className="thist-content">
          {error ? (
            <div className="thist-empty thist-error">{error}</div>
          ) : history === null ? (
            <div className="thist-empty">Loading activity…</div>
          ) : history.length === 0 ? (
            <div className="thist-empty">No activity recorded yet.</div>
          ) : (
            <ul className="thist-list">
              {history.map(e => <HistoryEntry key={e.id} entry={e} />)}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
