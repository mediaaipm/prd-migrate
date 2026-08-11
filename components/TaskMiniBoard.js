import { useState } from 'react'
import { railRollups, RAIL_STATE_LABEL } from '../lib/categories'
import CellPeekModal from './CellPeekModal'

const PRIORITY_COLOR = { low: '#64748b', medium: '#f59e0b', high: '#dc2626', critical: '#9f1239' }
const PRIORITY_LABEL = { low: 'Low', medium: 'Med', high: 'High', critical: 'Crit' }

// Matches the full board: one card per cell, the rest behind "+N more", so every
// rail row is the same height.
const CELL_VISIBLE = 1

// The swimlane board for a single story, rendered inline under its row in the
// list. Read-only on purpose: the list is where you *read* a story's shape across
// departments, and duplicating the board's three-axis drag machinery here would
// mean two places to keep the drop rules correct. Cards open the same detail the
// row does; to move work, use the Kanban tab.
//
// Deliberately reuses the `.swim-*` classes rather than a parallel set, so the
// inline board and the full board cannot drift apart visually.
export default function TaskMiniBoard({ cards, columns, categories, taskPrefix, storyTitle, onOpen }) {
  const rails = buildRails(cards, categories)
  // Fixed tracks — see the note on swimGrid in KanbanBoard.
  const grid = { gridTemplateColumns: `var(--swim-rail-w) repeat(${columns.length}, var(--swim-col-w))` }
  const [peek, setPeek] = useState(null)   // { railId, railName, status }

  const cellOf = (railId, status) =>
    cards.filter(c => c.category === railId && (c.task.status || 'todo') === status)

  const peekCol = peek ? columns.find(c => c.status === peek.status) : null

  return (
    <div className="swim-board mini-board">
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
            return (
              <div
                key={col.status}
                className={`swim-cell${cell.length ? '' : ' swim-cell--empty'}`}
              >
                {cell.slice(0, CELL_VISIBLE).map(({ task }) => (
                  <div
                    key={task.id}
                    className="kanban-card kanban-card--swim"
                    role="button"
                    tabIndex={0}
                    title={cardTitle(task)}
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
                  </div>
                ))}
                {cell.length > CELL_VISIBLE && (
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

function cardTitle(task) {
  return [
    task.title,
    task.assignees?.length ? `Assigned: ${task.assignees.map(a => (typeof a === 'object' ? a?.name : a)).join(', ')}` : '',
    task.dueDate ? `Due ${task.dueDate}` : '',
    task.priority ? `${PRIORITY_LABEL[task.priority]} priority` : '',
  ].filter(Boolean).join('\n')
}
