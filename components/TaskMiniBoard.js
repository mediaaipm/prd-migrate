import { useState } from 'react'
import { railRollups, RAIL_STATE_LABEL } from '../lib/categories'
import CellPeekModal from './CellPeekModal'

const PRIORITY_COLOR = { low: '#64748b', medium: '#f59e0b', high: '#dc2626', critical: '#9f1239' }
const PRIORITY_LABEL = { low: 'Low', medium: 'Med', high: 'High', critical: 'Crit' }

// Matches the full board: one card per cell, the rest behind "+N more", so every
// rail row is the same height.
const CELL_VISIBLE = 1

// The swimlane board for a single story: rails are categories (Frontend, Backend,
// QA…), columns are the project's kanban columns, cards are every descendant of
// the story flattened one level deep.
//
// Two modes, one component:
//   • read-only (no `onMove`) — inline under a story's row in the list, where the
//     row below is where a task actually gets edited, so a card just jumps there.
//   • live (`onMove` given) — the Board tab of the task detail, where the whole
//     team drags its own work across the stages. Cells expand to show every card
//     (`expand`), because a card hidden behind "+N more" cannot be picked up.
//
// Deliberately reuses the `.swim-*` classes rather than a parallel set, so the
// inline board and the full board cannot drift apart visually.
export default function TaskMiniBoard({
  cards, columns, categories, taskPrefix, storyTitle, onOpen, labelById = {},
  onMove, canMove, statusAllowed, canSetCategory = false, expand = false, showAssignees = false,
}) {
  const rails = buildRails(cards, categories)
  // Fixed tracks — see the note on swimGrid in KanbanBoard.
  const grid = { gridTemplateColumns: `var(--swim-rail-w) repeat(${columns.length}, var(--swim-col-w))` }
  const [peek, setPeek] = useState(null)       // { railId, railName, status }
  const [dragId, setDragId] = useState(null)
  const [over, setOver] = useState(null)       // "railId|status" of the hovered cell

  const live = typeof onMove === 'function'
  const mayMove = task => !live ? false : (canMove ? !!canMove(task) : true)
  const mayLand = status => !statusAllowed || statusAllowed(status)

  const cellOf = (railId, status) =>
    cards.filter(c => c.category === railId && (c.task.status || 'todo') === status)

  const peekCol = peek ? columns.find(c => c.status === peek.status) : null
  const cellKey = (railId, status) => `${railId}|${status}`

  function endDrag() {
    setDragId(null)
    setOver(null)
  }

  // One gesture, up to two fields — but only the ones that actually changed.
  // The rail axis is only written when the caller says categories are editable;
  // otherwise a sideways drag would silently re-department someone's task.
  function drop(railId, status) {
    const id = dragId
    endDrag()
    const card = cards.find(c => c.task.id === id)
    if (!card) return
    const patch = {}
    if ((card.task.status || 'todo') !== status) patch.status = status
    if (canSetCategory && card.category !== railId) patch.category = railId || null
    if (!Object.keys(patch).length) return
    onMove(id, patch)
  }

  return (
    <div className={`swim-board mini-board${live ? ' mini-board--live' : ''}`}>
      <div className="swim-head" style={grid}>
        <div className="swim-head-corner">Category</div>
        {columns.map(col => (
          <div key={col.status} className="swim-head-col">
            <span className="kanban-column-dot" style={{ background: col.color }} />
            <span>{col.label}</span>
          </div>
        ))}
      </div>

      {rails.map(rail => (
        <div className="swim-rail" style={grid} key={rail.id || '__none'}>
          <div
            className={[
              'swim-rail-label',
              rail.id ? '' : 'swim-rail-label--none',
              `swim-rail-label--${rail.state}`,
            ].filter(Boolean).join(' ')}
            style={rail.color ? { borderLeftColor: rail.color } : undefined}
            title={railTitle(rail)}
          >
            <div className="swim-rail-top">
              <span className="swim-rail-name">{rail.name}</span>
              <span className="swim-rail-count">{rail.done}/{rail.total}</span>
            </div>
            <span className="swim-rail-meter" aria-hidden="true">
              <span className="swim-rail-meter-fill" style={{ width: `${rail.pct}%` }} />
            </span>
            <span className={`swim-rail-state swim-rail-state--${rail.state}`}>
              {RAIL_STATE_LABEL[rail.state]}
            </span>
          </div>
          {columns.map(col => {
            const cell = cellOf(rail.id, col.status)
            // A lane the user may not set is marked while a card is in the air,
            // not permanently — the board must still read as one board when
            // nobody is dragging.
            const barred = live && dragId && !mayLand(col.status)
            const hot = live && over === cellKey(rail.id, col.status) && !barred
            return (
              <div
                key={col.status}
                className={[
                  'swim-cell',
                  cell.length ? '' : 'swim-cell--empty',
                  hot ? 'swim-cell--over' : '',
                  barred ? 'swim-cell--barred' : '',
                ].filter(Boolean).join(' ')}
                onDragOver={live ? e => {
                  if (!dragId || barred) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  setOver(cellKey(rail.id, col.status))
                } : undefined}
                onDragLeave={live ? e => {
                  if (!e.currentTarget.contains(e.relatedTarget)) setOver(null)
                } : undefined}
                onDrop={live ? e => {
                  if (!dragId || barred) return
                  e.preventDefault()
                  drop(rail.id, col.status)
                } : undefined}
              >
                {(expand ? cell : cell.slice(0, CELL_VISIBLE)).map(({ task }) => {
                  const grabbable = mayMove(task)
                  const cardLabels = labelsOf(task, labelById)
                  return (
                    <div
                      key={task.id}
                      className={[
                        'kanban-card kanban-card--swim',
                        cardLabels.length ? 'kanban-card--swim-labelled' : '',
                        grabbable ? 'kanban-card--grab' : '',
                        dragId === task.id ? 'kanban-card--dragging' : '',
                      ].filter(Boolean).join(' ')}
                      role="button"
                      tabIndex={0}
                      title={cardTitle(task, cardLabels, grabbable)}
                      draggable={grabbable}
                      onDragStart={grabbable ? e => {
                        e.dataTransfer.effectAllowed = 'move'
                        e.dataTransfer.setData('text/plain', task.id)
                        setDragId(task.id)
                      } : undefined}
                      onDragEnd={grabbable ? endDrag : undefined}
                      onClick={() => onOpen?.(task)}
                      onKeyDown={e => { if (e.key === 'Enter') onOpen?.(task) }}
                    >
                      <div className="kanban-card-swim-top">
                        <span className="kanban-card-swim-num">
                          {task.number || (task.seq != null ? (taskPrefix ? `${taskPrefix}-${task.seq}` : `#${task.seq}`) : '')}
                        </span>
                        {task.priority && (
                          <span
                            className="kanban-card-swim-dot"
                            style={{ background: PRIORITY_COLOR[task.priority] }}
                          />
                        )}
                      </div>
                      <div className="kanban-card-title">{task.title}</div>
                      {/* Labels sit below the title, not above it: the title is
                          what you scan for, and a row of colour on top of every
                          card would win that fight every time. Same chip and same
                          placement as the full board's swim card. */}
                      {cardLabels.length > 0 && (
                        <div className="kanban-card-swim-labels">
                          {cardLabels.map(l => (
                            <span
                              key={l.id}
                              className="kanban-label-chip kanban-label-chip--mini"
                              style={{ background: l.color }}
                              title={l.name}
                            >{l.name}</span>
                          ))}
                        </div>
                      )}
                      {/* Who is on it matters most on the shared board — that is
                          the whole point of everyone looking at the same grid. */}
                      {showAssignees && assigneeNames(task).length > 0 && (
                        <div className="swim-card-people">
                          {assigneeNames(task).slice(0, 3).map(name => (
                            <span key={name} className="swim-card-avatar" title={name}>{initials(name)}</span>
                          ))}
                          {assigneeNames(task).length > 3 && (
                            <span className="swim-card-avatar swim-card-avatar--more">
                              +{assigneeNames(task).length - 3}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
                {!expand && cell.length > CELL_VISIBLE && (
                  <button
                    className="swim-more"
                    title={`${cell.length} tasks here — click to see them`}
                    onClick={() => setPeek({ railId: rail.id, railName: rail.name, status: col.status })}
                  >
                    +{cell.length - CELL_VISIBLE}
                    <span className="swim-more-word">more</span>
                  </button>
                )}
              </div>
            )
          })}
        </div>
      ))}

      {/* Read-only, matching the board it sits in: the list row below is where a
          task in this story actually gets edited, so opening one jumps there. */}
      {peek && (
        <CellPeekModal
          tasks={cellOf(peek.railId, peek.status).map(c => c.task)}
          columns={columns}
          statusLabel={peekCol?.label || peek.status}
          statusColor={peekCol?.color}
          laneTitle={storyTitle || 'Story'}
          railName={peek.railName}
          taskPrefix={taskPrefix}
          isOverdue={d => !!d && d < new Date().toISOString().slice(0, 10)}
          subCount={t => {
            const kids = descendantsOf(t)
            return { done: kids.filter(k => k.status === 'done').length, total: kids.length }
          }}
          onOpen={t => { setPeek(null); onOpen?.(t) }}
          onClose={() => setPeek(null)}
        />
      )}
    </div>
  )
}

function descendantsOf(task) {
  const out = []
  for (const c of (task.children || [])) { out.push(c); out.push(...descendantsOf(c)) }
  return out
}

function assigneeNames(task) {
  const list = Array.isArray(task.assignees) ? task.assignees : (task.assignee ? [task.assignee] : [])
  return list.map(a => (typeof a === 'object' ? a?.name : a)).filter(Boolean)
}

function initials(name) {
  return String(name).split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

// Every configured category shows even at zero — a story where Data Entry has not
// started yet must still show the Data Entry row, otherwise "not started" and
// "does not exist" look identical. Uncategorised appears only when occupied.
function buildRails(cards, categories) {
  const rails = (categories || []).map(c => ({ id: c.id, name: c.name, color: c.color, orphan: c.orphan }))
  if (cards.some(c => !c.category)) rails.push({ id: '', name: 'Uncategorised', color: null })
  const list = rails.length ? rails : [{ id: '', name: 'Uncategorised', color: null }]
  // The effective category is already resolved per card, so look it up rather
  // than re-walking the tree for every rail.
  const catOfId = new Map(cards.map(c => [c.task.id, c.category]))
  return railRollups(list, cards.map(c => c.task), t => catOfId.get(t.id) || '')
}

function railTitle(rail) {
  if (rail.orphan) return 'This category is no longer configured'
  const lines = [`${rail.name} — ${RAIL_STATE_LABEL[rail.state]}`]
  if (rail.total) lines.push(`${rail.done} of ${rail.total} done`)
  if (rail.waitingOn.length) lines.push(`Waiting on ${rail.waitingOn.join(', ')}`)
  return lines.join('\n')
}

// A label whose definition was deleted drops off the card rather than rendering
// as a raw id — same rule the full board's swim card follows.
function labelsOf(task, labelById) {
  return (Array.isArray(task.labelIds) ? task.labelIds : [])
    .map(id => labelById[id])
    .filter(Boolean)
}

function cardTitle(task, cardLabels, grabbable) {
  return [
    task.title,
    cardLabels.length ? `Labels: ${cardLabels.map(l => l.name).join(', ')}` : '',
    task.assignees?.length ? `Assigned: ${task.assignees.map(a => (typeof a === 'object' ? a?.name : a)).join(', ')}` : '',
    task.dueDate ? `Due ${task.dueDate}` : '',
    task.priority ? `${PRIORITY_LABEL[task.priority]} priority` : '',
    grabbable ? 'Drag to another stage · click to open' : '',
  ].filter(Boolean).join('\n')
}
