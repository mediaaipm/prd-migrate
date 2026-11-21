import { useEffect, useState } from 'react'
import {
  createSprint, updateSprint, completeSprint, fetchSprintConfig, saveSprintConfig,
  WEEKDAYS, dateRange, fmtDay, sprintProgress,
} from '../lib/sprints'

function Modal({ title, onClose, wide, children }) {
  return (
    <div className="kanban-modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`kanban-modal${wide ? ' sprint-modal--wide' : ''}`} onKeyDown={e => { if (e.key === 'Escape') onClose() }}>
        <div className="kanban-modal-header">
          <span>{title}</span>
          <button className="kanban-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="task-form">{children}</div>
      </div>
    </div>
  )
}

function useSubmit(fn, onDone) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function run(...args) {
    setBusy(true); setError('')
    try { const r = await fn(...args); setBusy(false); onDone?.(r) } catch (e) { setError(e.message); setBusy(false) }
  }
  return { busy, error, run }
}

// --- Create / edit ------------------------------------------------------------------

// A new sprint's dates come from the cadence — the server fills them in when left
// blank, and the preview here shows which slot that will be.
export function SprintFormModal({ slug, sprint, defaults, onClose, onSaved }) {
  const editing = !!sprint?.id
  const [form, setForm] = useState(() => ({
    name: sprint?.name || '',
    goal: sprint?.goal || '',
    startDate: sprint?.startDate || defaults?.startDate || '',
    endDate: sprint?.endDate || defaults?.endDate || '',
    capacityPoints: sprint?.capacityPoints ?? '',
  }))
  const set = k => e => setForm(p => ({ ...p, [k]: e.target.value }))
  const { busy, error, run } = useSubmit(async () => {
    const body = { ...form, capacityPoints: form.capacityPoints === '' ? null : Number(form.capacityPoints) }
    return editing ? updateSprint(slug, sprint.id, body) : createSprint(slug, body)
  }, r => { onSaved?.(r); onClose() })

  return (
    <Modal title={editing ? `Edit ${sprint.name}` : 'New sprint'} onClose={onClose}>
      {error && <div className="kanban-col-error">{error}</div>}
      <input className="form-input" placeholder={editing ? 'Sprint name' : 'Name (blank = next “Sprint N”)'} value={form.name} onChange={set('name')} autoFocus maxLength={120} />
      <textarea className="form-input sprint-textarea" placeholder="Sprint goal — the one outcome this sprint must deliver (optional)" value={form.goal} onChange={set('goal')} rows={2} maxLength={500} />
      <div className="task-form-row">
        <label className="task-form-date">
          <span className="task-form-date-label">Start</span>
          <input className="form-input" type="date" value={form.startDate} onChange={set('startDate')} disabled={sprint?.status === 'completed'} />
        </label>
        <label className="task-form-date">
          <span className="task-form-date-label">End</span>
          <input className="form-input" type="date" value={form.endDate} onChange={set('endDate')} disabled={sprint?.status === 'completed'} />
        </label>
        <label className="task-form-date">
          <span className="task-form-date-label">Capacity</span>
          <input className="form-input" type="number" min="0" step="0.5" placeholder="pts" value={form.capacityPoints} onChange={set('capacityPoints')} title="Points the team can take on (optional)" />
        </label>
      </div>
      {!editing && <div className="task-form-hint">Leave the dates blank to take the next slot on the project's cadence. New sprints start as <strong>Planned</strong>.</div>}
      <div className="sprint-modal-actions">
        <button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn-primary" onClick={() => run()} disabled={busy}>{busy ? 'Saving…' : editing ? 'Save' : 'Create sprint'}</button>
      </div>
    </Modal>
  )
}

// --- Complete ------------------------------------------------------------------------

// Shows what closing will do before it happens: what landed, what rolls over and where
// it goes. The review notes are optional and can be edited later from the sprint list.
export function CompleteSprintModal({ slug, sprint, nextSprint, onClose, onDone }) {
  const p = sprintProgress(sprint)
  const unfinished = (sprint.stories || []).filter(t => t.status !== 'done')
  const [review, setReview] = useState({ wentWell: '', toImprove: '' })
  const { busy, error, run } = useSubmit(() => completeSprint(slug, sprint.id, review), r => { onDone?.(r); onClose() })

  return (
    <Modal title={`Complete ${sprint.name}`} onClose={onClose} wide>
      {error && <div className="kanban-col-error">{error}</div>}
      <div className="sprint-summary-grid">
        <div><strong>{p.storiesDone}/{p.stories}</strong><span>stories done</span></div>
        <div><strong>{p.tasksDone}/{p.tasks}</strong><span>tasks done</span></div>
        <div><strong>{p.pointsDone}/{p.points}</strong><span>points done</span></div>
        <div><strong>{unfinished.length}</strong><span>to carry over</span></div>
      </div>
      {unfinished.length > 0 ? (
        <div className="sprint-carry-box">
          <div className="sprint-carry-head">
            Unfinished stories move to <strong>{nextSprint ? nextSprint.name : 'a new sprint on your cadence'}</strong>
            {nextSprint && <span className="epic-muted"> ({dateRange(nextSprint)})</span>}
          </div>
          {unfinished.map(t => (
            <div key={t.id} className="sprint-carry-row">
              <span className="task-number">{t.number}</span>
              <span className="sprint-carry-title">{t.title}</span>
              <span className="epic-task-status">{(t.status || 'todo').replace(/-/g, ' ')}</span>
              {Number(t.carryOver) > 0 && <span className="carry-badge carry-badge--hot">↻ {Number(t.carryOver) + 1}</span>}
            </div>
          ))}
        </div>
      ) : (
        <div className="task-form-hint">Every story is done — nothing to carry over.</div>
      )}
      <label className="sprint-field">
        <span className="task-form-date-label">What went well</span>
        <textarea className="form-input sprint-textarea" rows={3} value={review.wentWell} onChange={e => setReview(r => ({ ...r, wentWell: e.target.value }))} />
      </label>
      <label className="sprint-field">
        <span className="task-form-date-label">What to improve</span>
        <textarea className="form-input sprint-textarea" rows={3} value={review.toImprove} onChange={e => setReview(r => ({ ...r, toImprove: e.target.value }))} />
      </label>
      <div className="sprint-modal-actions">
        <button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn-primary" onClick={() => run()} disabled={busy}>{busy ? 'Completing…' : 'Complete sprint'}</button>
      </div>
    </Modal>
  )
}

// --- Review (completed sprint) -------------------------------------------------------

export function SprintReviewModal({ slug, sprint, canEdit, onClose }) {
  const sum = sprint.summary || {}
  const [review, setReview] = useState({ wentWell: sprint.review?.wentWell || '', toImprove: sprint.review?.toImprove || '' })
  const { busy, error, run } = useSubmit(() => updateSprint(slug, sprint.id, { review }), onClose)
  const scope = (sum.committedStories || 0) + (sum.addedStories || 0)

  return (
    <Modal title={`${sprint.name} — review`} onClose={onClose} wide>
      {error && <div className="kanban-col-error">{error}</div>}
      <div className="epic-muted">
        {dateRange(sprint)} · {sprint.autoCompleted ? 'closed automatically at its end date' : `completed${sprint.completedBy ? ` by ${sprint.completedBy}` : ''}`}
        {sprint.completedAt && ` on ${fmtDay(sprint.completedAt.slice(0, 10), true)}`}
      </div>
      {sprint.goal && <div className="sprint-goal">🎯 {sprint.goal}</div>}
      {sprint.summary ? (
        <div className="sprint-summary-grid">
          <div><strong>{sum.completedStories}/{scope}</strong><span>stories done</span></div>
          <div><strong>{sum.committedStories}</strong><span>committed at start</span></div>
          <div><strong>{sum.addedStories}</strong><span>added mid-sprint</span></div>
          <div><strong>{sum.carriedStories}</strong><span>carried over</span></div>
          <div><strong>{sum.completedPoints}/{sum.totalPoints}</strong><span>points done</span></div>
          <div><strong>{scope ? Math.round((sum.completedStories / scope) * 100) : 0}%</strong><span>commitment met</span></div>
        </div>
      ) : (
        <div className="task-form-hint">This sprint closed before summaries were recorded.</div>
      )}
      <label className="sprint-field">
        <span className="task-form-date-label">What went well</span>
        <textarea className="form-input sprint-textarea" rows={3} value={review.wentWell} disabled={!canEdit} onChange={e => setReview(r => ({ ...r, wentWell: e.target.value }))} />
      </label>
      <label className="sprint-field">
        <span className="task-form-date-label">What to improve</span>
        <textarea className="form-input sprint-textarea" rows={3} value={review.toImprove} disabled={!canEdit} onChange={e => setReview(r => ({ ...r, toImprove: e.target.value }))} />
      </label>
      <div className="sprint-modal-actions">
        <button className="btn-ghost" onClick={onClose} disabled={busy}>Close</button>
        {canEdit && <button className="btn-primary" onClick={() => run()} disabled={busy}>{busy ? 'Saving…' : 'Save notes'}</button>}
      </div>
    </Modal>
  )
}

// --- Cadence -------------------------------------------------------------------------

export function CadenceModal({ slug, onClose }) {
  const [config, setConfig] = useState(null)
  const [preview, setPreview] = useState(null)
  const [loadError, setLoadError] = useState('')
  useEffect(() => {
    fetchSprintConfig(slug).then(r => { setConfig(r.config); setPreview(r.preview) }).catch(e => setLoadError(e.message))
  }, [slug])
  const { busy, error, run } = useSubmit(() => saveSprintConfig(slug, config), onClose)

  // Live preview of the next slot, computed the same way as the server.
  const local = config && (() => {
    const today = new Date()
    const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const start = new Date(today)
    start.setDate(start.getDate() + ((config.startDay - start.getDay() + 7) % 7))
    const end = new Date(start)
    end.setDate(end.getDate() + (config.lengthWeeks - 1) * 7 + ((config.endDay - config.startDay + 7) % 7))
    return { startDate: iso(start), endDate: iso(end) }
  })()
  const shown = local || preview
  const setNum = k => e => setConfig(c => ({ ...c, [k]: Number(e.target.value) }))

  return (
    <Modal title="Sprint cadence" onClose={onClose}>
      {(error || loadError) && <div className="kanban-col-error">{error || loadError}</div>}
      {!config ? <div className="epic-muted">Loading…</div> : (
        <>
          <div className="task-form-row">
            <label className="task-form-date">
              <span className="task-form-date-label">Length</span>
              <select className="form-input" value={config.lengthWeeks} onChange={setNum('lengthWeeks')}>
                {[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n} week{n > 1 ? 's' : ''}</option>)}
              </select>
            </label>
            <label className="task-form-date">
              <span className="task-form-date-label">Starts on</span>
              <select className="form-input" value={config.startDay} onChange={setNum('startDay')}>
                {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
            </label>
            <label className="task-form-date">
              <span className="task-form-date-label">Ends on</span>
              <select className="form-input" value={config.endDay} onChange={setNum('endDay')}>
                {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
            </label>
          </div>
          {shown && (
            <div className="sprint-cadence-preview">
              Next sprint slot: <strong>{fmtDay(shown.startDate)} ({WEEKDAYS[config.startDay]})</strong> → <strong>{fmtDay(shown.endDate, true)} ({WEEKDAYS[config.endDay]})</strong>
            </div>
          )}
          <label className="sprint-check">
            <input type="checkbox" checked={config.autoRollover} onChange={e => setConfig(c => ({ ...c, autoRollover: e.target.checked }))} />
            <span><strong>Auto-close on the last day.</strong> At the end of the sprint's last day ({WEEKDAYS[config.endDay]}), the active sprint closes and its unfinished stories move to the next sprint.</span>
          </label>
          <label className="sprint-check">
            <input type="checkbox" checked={config.alwaysCreateNext} onChange={e => setConfig(c => ({ ...c, alwaysCreateNext: e.target.checked }))} />
            <span><strong>Always open the next sprint.</strong> Closing a sprint creates the next one on this cadence even when nothing carries over. Off: it is only created when there are unfinished stories to move.</span>
          </label>
          <label className="sprint-check">
            <input type="checkbox" checked={config.autoStart} onChange={e => setConfig(c => ({ ...c, autoStart: e.target.checked }))} />
            <span><strong>Auto-start on start date.</strong> A planned sprint starts by itself on its start day ({WEEKDAYS[config.startDay]}) when no sprint is active — including the one opened when a sprint is completed early.</span>
          </label>
          <label className="sprint-check">
            <input type="checkbox" checked={config.earlyComplete} onChange={e => setConfig(c => ({ ...c, earlyComplete: e.target.checked }))} />
            <span><strong>Allow completing early.</strong> Off: "Complete sprint" appears on the sprint's last day. On: it can be completed any day.</span>
          </label>
          <div className="sprint-modal-actions">
            <button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="btn-primary" onClick={() => run()} disabled={busy}>{busy ? 'Saving…' : 'Save cadence'}</button>
          </div>
        </>
      )}
    </Modal>
  )
}
