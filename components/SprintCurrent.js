import { useMemo, useState } from 'react'
import SprintBoard from './SprintBoard'
import { CompleteSprintModal } from './SprintModals'
import { startSprint, dateRange, daysLeft, sprintProgress, fmtDay, WEEKDAYS } from '../lib/sprints'
import { useOptimistic } from '../lib/optimistic'

// The sprint being worked: header with goal, time left and progress against capacity,
// then the sprint's own board. With nothing active it shows the next planned sprint —
// after a close that is the sprint the leftovers went to, waiting for its start day.
export default function SprintCurrent({ slug, sprints, config, today, velocity, canManage, allTasks, currentUser, taskAcl, taskPrefix, onPlan, onCreateSprint }) {
  const [completing, setCompleting] = useState(false)
  const [busy, setBusy] = useState(false)
  const active = sprints.find(s => s.status === 'active') || null
  const nextPlanned = sprints.filter(s => s.status === 'planned').sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)))[0] || null

  // Queued card moves applied on top of the sprint's tasks, so a drag shows at once.
  // No scope: the sprint spans every version route, and task ids are unique across
  // the project. Rows the overlay would add (creates elsewhere) are dropped.
  const shown = active || nextPlanned
  const serverTasks = shown?.tasks || []
  const overlaid = useOptimistic(serverTasks, { entity: 'task', cascade: true })
  const boardTasks = useMemo(() => {
    const ids = new Set(serverTasks.map(t => t.id))
    return overlaid.filter(t => ids.has(t.id))
  }, [overlaid, serverTasks])

  if (!active && nextPlanned) {
    const p = sprintProgress({ ...nextPlanned, tasks: boardTasks, stories: boardTasks.filter(t => (nextPlanned.storyIds || []).includes(t.id)) })
    const startsIn = nextPlanned.startDate && today ? daysLeft(nextPlanned.startDate, today) - 1 : null // daysLeft counts both ends
    const startDay = nextPlanned.startDate ? `${WEEKDAYS[new Date(`${nextPlanned.startDate}T00:00:00`).getDay()]}, ${fmtDay(nextPlanned.startDate)}` : ''
    const autoStarts = config?.autoStart !== false && !!nextPlanned.startDate
    return (
      <>
        <div className="section-card sprint-hero sprint-hero--upcoming">
          <div className="sprint-hero-top">
            <div>
              <div className="sprint-hero-name">{nextPlanned.name} <span className="badge">Up next</span></div>
              <div className="epic-muted">
                {dateRange(nextPlanned)}
                {startDay && <> · {autoStarts ? 'starts automatically on ' : 'planned to start '}<strong>{startDay}</strong>{startsIn > 0 && ` (in ${startsIn} day${startsIn === 1 ? '' : 's'})`}</>}
              </div>
            </div>
            {canManage && (
              <div className="sprint-hero-actions">
                <button className="btn-ghost" onClick={() => onPlan(nextPlanned)}>Plan it</button>
                <button className="btn-ghost" disabled={busy} onClick={async () => {
                  if (!window.confirm(`Start ${nextPlanned.name} now instead of ${startDay || 'its start day'}?`)) return
                  setBusy(true)
                  try { await startSprint(slug, nextPlanned.id) } catch (e) { alert(e.message) }
                  setBusy(false)
                }}>Start now</button>
              </div>
            )}
          </div>
          {nextPlanned.goal && <div className="sprint-goal">🎯 {nextPlanned.goal}</div>}
          <div className="sprint-summary-grid">
            <div><strong>{p.stories}</strong><span>stories planned</span></div>
            <div><strong>{p.tasks}</strong><span>tasks</span></div>
            <div><strong>{p.points}</strong><span>points</span></div>
            {(nextPlanned.carriedInStoryIds || []).length > 0 && <div><strong>{nextPlanned.carriedInStoryIds.length}</strong><span>carried in</span></div>}
          </div>
        </div>
        {p.tasks === 0 ? (
          <div className="section-card epic-empty">Nothing planned yet.{canManage && <> <button className="btn-primary epic-btn-sm" onClick={() => onPlan(nextPlanned)}>Plan stories</button></>}</div>
        ) : (
          <div className="section-card sprint-current-board">
            <SprintBoard slug={slug} tasks={boardTasks} allTasks={allTasks} currentUser={currentUser} taskAcl={taskAcl} taskPrefix={taskPrefix} />
          </div>
        )}
      </>
    )
  }

  if (!active) {
    return (
      <div className="section-card epic-empty sprint-none">
        <div>No sprint is running.</div>
        {canManage && <button className="btn-primary" onClick={onCreateSprint}>+ New Sprint</button>}
      </div>
    )
  }

  const p = sprintProgress({ ...active, tasks: boardTasks, stories: boardTasks.filter(t => (active.storyIds || []).includes(t.id)) })
  const left = daysLeft(active.endDate, today)
  const limit = active.capacityPoints ?? velocity
  const overdue = active.endDate && today && active.endDate < today
  // Completing by hand opens on the sprint's last day, unless the cadence allows early.
  const canCompleteNow = !active.endDate || !today || config?.earlyComplete || today >= active.endDate

  return (
    <>
      <div className="section-card sprint-hero">
        <div className="sprint-hero-top">
          <div>
            <div className="sprint-hero-name">{active.name}</div>
            <div className="epic-muted">
              {dateRange(active)}
              {left != null && <> · <span className={left <= 2 ? 'epic-late' : ''}>{overdue ? 'past its end date — closes at the next rollover' : left > 0 ? `${left} day${left === 1 ? '' : 's'} left` : 'ends today'}</span></>}
            </div>
          </div>
          <div className="sprint-hero-actions">
            {canManage && <button className="btn-ghost" onClick={() => onPlan(active)}>Add stories</button>}
            {canManage && (canCompleteNow
              ? <button className="btn-primary" onClick={() => setCompleting(true)}>Complete sprint</button>
              : <span className="sprint-complete-hint" title="An admin can allow early completion in the cadence settings">Complete on {fmtDay(active.endDate)}</span>)}
          </div>
        </div>
        {active.goal && <div className="sprint-goal">🎯 {active.goal}</div>}
        <div className="sprint-summary-grid">
          <div><strong>{p.storiesDone}/{p.stories}</strong><span>stories done</span></div>
          <div><strong>{p.tasksDone}/{p.tasks}</strong><span>tasks done</span></div>
          <div><strong>{p.pointsDone}/{p.points}</strong><span>points done</span></div>
          {limit != null && <div className={p.points > limit ? 'is-over' : ''}><strong>{limit}p</strong><span>{active.capacityPoints != null ? 'capacity' : 'avg velocity'}</span></div>}
          {(active.carriedInStoryIds || []).length > 0 && <div><strong>{active.carriedInStoryIds.length}</strong><span>carried in</span></div>}
        </div>
        <div className="epic-progress"><div className="epic-progress-fill" style={{ width: `${p.stories ? (p.storiesDone / p.stories) * 100 : 0}%` }} /></div>
      </div>

      {p.tasks === 0 ? (
        <div className="section-card epic-empty">This sprint has no stories yet.{canManage && <> <button className="btn-primary epic-btn-sm" onClick={() => onPlan(active)}>Plan stories</button></>}</div>
      ) : (
        <div className="section-card sprint-current-board">
          <SprintBoard slug={slug} tasks={boardTasks} allTasks={allTasks} currentUser={currentUser} taskAcl={taskAcl} taskPrefix={taskPrefix} />
        </div>
      )}

      {completing && (
        <CompleteSprintModal slug={slug} sprint={active} nextSprint={nextPlanned} onClose={() => setCompleting(false)} />
      )}
    </>
  )
}
