import { SUBTASK_STATUSES, subtaskStatus } from '../lib/subtask-status'

// The sub-tasks under a story card, on the project board and the sprint board. Rows
// are not draggable — only the story moves between columns (lib/subtask-status.js).
// Each row shows its status as one of three and, when the viewer may change it, lets
// them set it right there.
//
// items: [{ task, depth }] in tree order (depth 0 = direct child of the story).
export default function SubtaskList({ items, onOpen, onSetStatus, canSet, label }) {
  if (!items.length) return null
  const done = items.filter(i => i.task.status === 'done').length
  return (
    <div className="subtask-list" onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} draggable={false} onDragStart={e => { e.preventDefault(); e.stopPropagation() }}>
      <div className="subtask-list-head">
        <span>Sub-tasks</span>
        <span className="subtask-list-count">{done}/{items.length}</span>
      </div>
      {items.map(({ task, depth }) => {
        const state = subtaskStatus(task.status)
        const editable = canSet(task)
        const id = label ? label(task) : ''
        return (
          <div key={task.id} className={`subtask-row subtask-row--${state}`} style={{ '--depth': depth }}>
            <button type="button" className="subtask-row-title" onClick={() => onOpen(task)} title={`Open “${task.title}”`}>
              {id && <span className="subtask-row-id">{id}</span>}
              <span className="subtask-row-text">{task.title}</span>
            </button>
            {editable ? (
              <select
                className={`subtask-status subtask-status--${state}`}
                value={state}
                onChange={e => onSetStatus(task, e.target.value)}
                aria-label={`Status of “${task.title}”`}
              >
                {SUBTASK_STATUSES.map(s => <option key={s.status} value={s.status}>{s.label}</option>)}
              </select>
            ) : (
              <span className={`subtask-status subtask-status--${state} subtask-status--static`}>
                {SUBTASK_STATUSES.find(s => s.status === state).label}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
