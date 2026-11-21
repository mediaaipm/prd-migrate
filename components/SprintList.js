import { useState } from 'react'
import { startSprint, deleteSprint, dateRange, daysLeft, sprintProgress, SPRINT_STATUS } from '../lib/sprints'
import { SprintFormModal, SprintReviewModal } from './SprintModals'

// Every sprint of the project on one timeline: active first, then what is planned in
// date order, then history newest-first.

function StatusChip({ status }) {
  const s = SPRINT_STATUS[status] || SPRINT_STATUS.planned
  return <span className={`epic-status epic-status--${s.tint}`}>{s.label}</span>
}

function Row({ slug, sprint, today, canManage, canDeleteCompleted, hasActive, onOpen, onPlan, onEdit, onReview }) {
  const [busy, setBusy] = useState(false)
  const completed = sprint.status === 'completed'
  const p = sprintProgress(sprint)
  const sum = sprint.summary
  // A closed sprint reports its frozen result, not today's state of its stories.
  const done = completed && sum ? sum.completedStories : p.storiesDone
  const total = completed && sum ? (sum.committedStories || 0) + (sum.addedStories || 0) : p.stories
  const left = sprint.status === 'active' ? daysLeft(sprint.endDate, today) : null
  const canDelete = canManage && sprint.status !== 'active' && (!completed || canDeleteCompleted)

  async function act(fn) {
    setBusy(true)
    try { await fn() } catch (e) { alert(e.message) }
    setBusy(false)
  }

  return (
    <div className={`sprint-row sprint-row--${sprint.status}`}>
      <div className="sprint-row-main" onClick={() => (completed ? onReview(sprint) : onOpen(sprint))} role="button" tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter') (completed ? onReview(sprint) : onOpen(sprint)) }}>
        <div className="sprint-row-title">
          <strong>{sprint.name}</strong>
          <StatusChip status={sprint.status} />
          {sprint.autoCompleted && <span className="epic-muted" title="Closed by the cadence at its end date">auto</span>}
        </div>
        <div className="epic-muted sprint-row-dates">
          {dateRange(sprint)}
          {left != null && <> · <span className={left <= 2 ? 'epic-late' : ''}>{left > 0 ? `${left} day${left === 1 ? '' : 's'} left` : 'ends today'}</span></>}
        </div>
        {sprint.goal && <div className="sprint-row-goal">🎯 {sprint.goal}</div>}
      </div>
      <div className="sprint-row-stats">
        <div className="epic-progress"><div className="epic-progress-fill" style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></div>
        <span className="epic-muted">
          {done}/{total} stories
          {completed && sum?.carriedStories > 0 && <> · <span className="sf-carried">{sum.carriedStories} carried</span></>}
          {!completed && (sprint.carriedInStoryIds || []).length > 0 && <> · {(sprint.carriedInStoryIds || []).length} carried in</>}
        </span>
      </div>
      <div className="sprint-row-actions">
        {sprint.status === 'planned' && canManage && (
          <>
            <button className="btn-ghost epic-btn-sm" onClick={() => onPlan(sprint)}>Plan</button>
            <button className="btn-primary epic-btn-sm" disabled={busy || hasActive} title={hasActive ? 'Complete the active sprint first' : 'Start this sprint'}
              onClick={() => act(() => startSprint(slug, sprint.id))}>Start</button>
          </>
        )}
        {completed && <button className="btn-ghost epic-btn-sm" onClick={() => onReview(sprint)}>Review</button>}
        {canManage && <button className="btn-ghost epic-btn-sm" onClick={() => onEdit(sprint)}>Edit</button>}
        {canDelete && (
          <button className="task-action-btn danger" disabled={busy} title="Delete sprint"
            onClick={() => {
              const warn = completed ? ' Its history leaves velocity and story-flow charts.' : ' Its stories go back to being unplanned.'
              if (confirm(`Delete “${sprint.name}”?${warn} This cannot be undone.`)) act(() => deleteSprint(slug, sprint.id))
            }}>✕</button>
        )}
      </div>
    </div>
  )
}

export default function SprintList({ slug, sprints, today, canManage, canDeleteCompleted, onOpen, onPlan }) {
  const [editing, setEditing] = useState(null)
  const [reviewing, setReviewing] = useState(null)
  const active = sprints.filter(s => s.status === 'active')
  const planned = sprints.filter(s => s.status === 'planned')
  const completed = sprints.filter(s => s.status === 'completed').slice().reverse()
  const hasActive = active.length > 0
  const rowProps = { slug, today, canManage, canDeleteCompleted, hasActive, onOpen, onPlan, onEdit: setEditing, onReview: setReviewing }

  return (
    <div className="sprint-list">
      {!sprints.length && <div className="section-card epic-empty">No sprints yet.</div>}
      {[['Active', active], ['Planned', planned], ['Completed', completed]].map(([label, list]) => list.length > 0 && (
        <section key={label} className="section-card sprint-list-group">
          <div className="backlog-group-head">{label} <span className="epic-filter-count">{list.length}</span></div>
          {list.map(s => <Row key={s.id} sprint={s} {...rowProps} />)}
        </section>
      ))}
      {editing && <SprintFormModal slug={slug} sprint={editing} onClose={() => setEditing(null)} />}
      {reviewing && <SprintReviewModal slug={slug} sprint={reviewing} canEdit={canManage} onClose={() => setReviewing(null)} />}
    </div>
  )
}
