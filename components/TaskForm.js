import { useState, useRef } from 'react'
import PointsSelect from './PointsSelect'
import { statusOptions, isSubtaskStatus, subtaskStatus } from '../lib/subtask-status'
import AssigneeInput from './AssigneeInput'
import AutoTextarea from './AutoTextarea'
import SubmitButton from './SubmitButton'
import { attSrc } from '../lib/attachment-src'
import { makeAcceptanceItem, MAX_ACCEPTANCE_TEXT, MAX_ACCEPTANCE_ITEMS } from '../lib/task-acceptance'
import { USER_STORY_PARTS, MAX_USER_STORY_TEXT, blankUserStory } from '../lib/user-story'

const MAX_ATTACH_BYTES = 1024 * 1024 // 1MB cap per image (stored inline as data URL in Redis)

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function blankForm() {
  return { title: '', description: '', status: 'todo', priority: 'medium', category: '', epicId: '', assignees: [], assignedBy: '', startDate: '', dueDate: '', numberOverride: '', points: '', attachments: [], cover: null, labelIds: [], userStory: blankUserStory(), acceptance: [] }
}

// The one task composer/editor. The list, the board and the board's modals all
// mount this, so "Add Task" asks for exactly the same fields wherever it is
// opened from.
//
// `quickAdd` collapses everything but the title behind a "More options" toggle — the
// common case is a title and Enter. `allowAddAnother` keeps the form open and cleared
// after a save so several sub-tasks can be typed in a row.
// `isSubtask`: the task is (or will be) a sub-task, so status offers the three
// sub-task states instead of the board columns (lib/subtask-status.js). `isNew`: the
// form creates one — an off-scale status inherited from the parent is snapped onto
// the three rather than offered as an "(old)" choice.
export default function TaskForm({ initial, onSave, onCancel, label, assignees = [], showCreator = false, currentUser = null, quickAdd = false, allowAddAnother = false, columns = [], categories = [], inheritedCategory = '', labels = [], requireLabel = false, titlePlaceholder, epics = [], showEpic = false, isSubtask = false, isNew = false }) {
  // Captured once: the legacy status the task arrived with, so it can stay selectable.
  const [arrivedStatus] = useState(() => (isNew ? null : initial?.status))
  function makeInitial() {
    let base = initial || blankForm()
    // A new sub-task starts in one of its three states, whatever column it came from.
    if (isSubtask && isNew && base.status && !isSubtaskStatus(base.status)) base = { ...base, status: subtaskStatus(base.status) }
    // Auto-attribute the creator from the logged-in user; no manual entry.
    if (showCreator && !base.assignedBy && currentUser?.name) return { ...base, assignedBy: currentUser.name }
    return base
  }
  const [form, setForm] = useState(makeInitial)
  // What the story fields held when the form opened. An edit that leaves them alone
  // must not send them: a stale acceptance list would undo a tick someone made since.
  const [storyAtOpen] = useState(() => JSON.stringify([initial?.userStory || null, initial?.acceptance || []]))
  const [newAc, setNewAc] = useState('')
  const [expanded, setExpanded] = useState(!quickAdd)
  const [addAnother, setAddAnother] = useState(false)
  const titleRef = useRef(null)
  const f = (k) => e => setForm(p => ({ ...p, [k]: e.target.value }))
  // Text typed in the assignee box but not yet turned into a token. Held in a ref
  // (not state) so it's always current at save time without a blur→re-render race.
  const pendingAssignee = useRef('')

  // onSave only enqueues now, so there is no response to await. SubmitButton owns the
  // busy state and the double-click guard.
  const formLabels = Array.isArray(form.labelIds) ? form.labelIds : []
  // Mirrors lib/require-label.js: mandatory, but only once the project has labels
  // to pick from — and only on create, never on an edit of an older task.
  const labelMissing = requireLabel && labels.length > 0 && formLabels.length === 0

  function toggleLabel(id) {
    setForm(p => {
      const ids = Array.isArray(p.labelIds) ? p.labelIds : []
      return { ...p, labelIds: ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id] }
    })
  }

  // In the quick form everything below the title hides behind "More options" — a
  // mandatory field cannot live there, or the Add button is dead for a reason the
  // user cannot see. So when it is required, it comes out of the drawer.
  const showLabelsInline = quickAdd && requireLabel && labels.length > 0
  const labelPicker = labels.length > 0 ? (
    <div className="task-form-labels">
      <span className="task-form-labels-title">
        Labels{requireLabel ? ' *' : ''}
      </span>
      <div className="task-form-labels-chips">
        {labels.map(l => {
          const on = formLabels.includes(l.id)
          return (
            <button
              key={l.id}
              type="button"
              className="kanban-label-chip kanban-label-chip--toggle"
              style={{ background: on ? l.color : 'transparent', color: on ? '#fff' : l.color, borderColor: l.color }}
              onClick={() => toggleLabel(l.id)}
            >{on ? '✓ ' : ''}{l.name}</button>
          )
        })}
      </div>
      {labelMissing && <span className="kanban-label-required">Pick at least one label</span>}
    </div>
  ) : null

  function submit() {
    if (!form.title.trim() || labelMissing) return
    const pending = pendingAssignee.current.trim()
    const cur = Array.isArray(form.assignees) ? form.assignees : []
    const assigneesFinal = pending && !cur.includes(pending) ? [...cur, pending] : cur
    const keepOpen = allowAddAnother && addAnother
    const out = { ...form, assignees: assigneesFinal }
    const pendingAc = newAc.trim()
    if (!isSubtask && pendingAc) out.acceptance = [...(form.acceptance || []), makeAcceptanceItem(pendingAc, currentUser?.name || null)]
    if (isSubtask || JSON.stringify([out.userStory || null, out.acceptance || []]) === storyAtOpen) {
      delete out.userStory
      delete out.acceptance
    }
    onSave(out, { keepOpen })
    setNewAc('')
    if (!keepOpen) return
    // Keep the inherited defaults (status, priority, assignees, dates); clear what is
    // unique to the task just added.
    setForm(p => ({ ...p, title: '', description: '', numberOverride: '', attachments: [], cover: null, userStory: blankUserStory(), acceptance: [] }))
    pendingAssignee.current = ''
    requestAnimationFrame(() => titleRef.current?.focus())
  }

  function onFormKeyDown(e) {
    if (e.key === 'Escape') { e.stopPropagation(); onCancel?.() }
  }
  function onTitleKeyDown(e) {
    if (e.key === 'Enter' && !e.nativeEvent?.isComposing) { e.preventDefault(); submit() }
  }

  async function addImages(fileList) {
    const files = Array.from(fileList || [])
    const added = []
    for (const file of files) {
      if (!(file.type || '').startsWith('image/')) continue
      if (file.size > MAX_ATTACH_BYTES) { alert(`"${file.name}" is too large (max ${Math.round(MAX_ATTACH_BYTES / 1024)}KB).`); continue }
      const dataUrl = await readFileAsDataUrl(file)
      added.push({
        id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: file.name, type: file.type, size: file.size, dataUrl,
        uploadedAt: new Date().toISOString(),
      })
    }
    if (added.length) setForm(p => ({ ...p, attachments: [...(p.attachments || []), ...added] }))
  }
  function removeImage(id) {
    setForm(p => ({
      ...p,
      attachments: (p.attachments || []).filter(a => a.id !== id),
      cover: p.cover && p.cover.attId === id ? null : p.cover,
    }))
  }
  function toggleCover(att) {
    // Reference only — see setCover in KanbanBoard.
    setForm(p => ({ ...p, cover: p.cover?.attId === att.id ? null : { attId: att.id } }))
  }

  const addAnotherBox = allowAddAnother ? (
    <label className="task-quick-another" title="Keep this form open after adding">
      <input type="checkbox" checked={addAnother} onChange={e => setAddAnother(e.target.checked)} />
      Add another
    </label>
  ) : null

  // Stories only: the user-story statement and the acceptance criteria — what has to
  // be true before the story is done. Sub-tasks are how a story gets built, not
  // separate contracts, so they get neither.
  const story = { ...blankUserStory(), ...(form.userStory || {}) }
  const acItems = Array.isArray(form.acceptance) ? form.acceptance : []
  function setStoryPart(key, value) {
    setForm(p => ({ ...p, userStory: { ...blankUserStory(), ...(p.userStory || {}), [key]: value } }))
  }
  function addAc() {
    const text = newAc.trim()
    if (!text || acItems.length >= MAX_ACCEPTANCE_ITEMS) return
    setForm(p => ({ ...p, acceptance: [...(p.acceptance || []), makeAcceptanceItem(text, currentUser?.name || null)] }))
    setNewAc('')
  }
  function editAc(id, text) {
    setForm(p => ({ ...p, acceptance: (p.acceptance || []).map(i => (i.id === id ? { ...i, text } : i)) }))
  }
  function removeAc(id) {
    setForm(p => ({ ...p, acceptance: (p.acceptance || []).filter(i => i.id !== id) }))
  }
  const storyFields = (
    <div className="task-form-story">
      <div className="task-form-story-block">
        <span className="task-form-labels-title">User story</span>
        <div className="task-form-story-parts">
          {USER_STORY_PARTS.map(part => (
            <label key={part.key} className="task-form-story-part">
              <span className="task-form-story-lead">{part.label}</span>
              <input
                className="form-input"
                placeholder={part.placeholder}
                value={story[part.key]}
                maxLength={MAX_USER_STORY_TEXT}
                onChange={e => setStoryPart(part.key, e.target.value)}
              />
            </label>
          ))}
        </div>
      </div>
      <div className="task-form-story-block">
        <span className="task-form-labels-title">
          Acceptance criteria{acItems.length > 0 ? ` (${acItems.length})` : ''}
        </span>
        {acItems.length > 0 && (
          <ol className="task-form-ac-list">
            {acItems.map(item => (
              <li key={item.id} className={`task-form-ac-row${item.done ? ' is-done' : ''}`}>
                <input
                  className="form-input"
                  value={item.text}
                  maxLength={MAX_ACCEPTANCE_TEXT}
                  onChange={e => editAc(item.id, e.target.value)}
                  aria-label="Acceptance criterion"
                  title={item.done ? `Met${item.doneBy ? ` by ${item.doneBy}` : ''}` : undefined}
                />
                <button type="button" className="task-check-remove" onClick={() => removeAc(item.id)} title="Remove criterion">✕</button>
              </li>
            ))}
          </ol>
        )}
        <div className="task-check-add">
          <input
            className="form-input"
            placeholder={acItems.length ? 'Add another criterion…' : 'Given… when… then… — one condition per line'}
            value={newAc}
            maxLength={MAX_ACCEPTANCE_TEXT}
            onChange={e => setNewAc(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent?.isComposing) { e.preventDefault(); addAc() } }}
          />
          <button
            type="button"
            className="btn-ghost task-check-add-btn"
            onClick={addAc}
            disabled={!newAc.trim() || acItems.length >= MAX_ACCEPTANCE_ITEMS}
          >Add</button>
        </div>
      </div>
    </div>
  )

  const advanced = (
    <>
      {quickAdd && (
        <input className="form-input task-num-input" placeholder="# override (e.g. 1.2.3)" value={form.numberOverride} onChange={f('numberOverride')} title="Custom number (leave blank for auto)" />
      )}
      <AutoTextarea className="form-input task-desc-input" placeholder="Description (optional)" value={form.description} onChange={f('description')} />
      {!isSubtask && storyFields}
      <div className="task-form-row">
        <select className="form-input" value={form.status} onChange={f('status')}>
          {statusOptions(columns, isSubtask ? { parentId: true, status: arrivedStatus } : null).map(c => <option key={c.status} value={c.status}>{c.label}</option>)}
        </select>
        <select className="form-input" value={form.priority} onChange={f('priority')}>
          <option value="low">Low priority</option>
          <option value="medium">Medium priority</option>
          <option value="high">High priority</option>
          <option value="critical">Critical priority</option>
        </select>
        {/* Optional. Left blank the task counts as 1 in velocity and burndown, so a
            team that does not estimate loses nothing by ignoring this. */}
        <PointsSelect
          className="form-input task-points-input"
          placeholder="Pts"
          title="Story points, Fibonacci scale (optional) — blank counts as 1"
          value={form.points}
          onChange={f('points')}
        />
        {categories.length > 0 && (
          // Blank is not "no category" but "inherit from the nearest ancestor" —
          // spelling that out here is cheaper than explaining it after the fact.
          <select className="form-input" value={form.category || ''} onChange={f('category')} title="Category">
            <option value="">
              {inheritedCategory
                ? `Inherit — ${categories.find(c => c.id === inheritedCategory)?.name || inheritedCategory}`
                : 'No category'}
            </option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        {/* Stories only — a sub-task is in its story's epic, so the caller passes
            showEpic just for a root create/edit. */}
        {showEpic && epics.length > 0 && (
          <select className="form-input" value={form.epicId || ''} onChange={f('epicId')} title="Epic">
            <option value="">No epic</option>
            {epics.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        )}
      </div>
      {!showLabelsInline && labelPicker}
      <AssigneeInput
        value={form.assignees}
        options={assignees}
        onChange={next => setForm(p => ({ ...p, assignees: next }))}
        onQueryChange={v => { pendingAssignee.current = v }}
      />
      {showCreator && (
        form.assignedBy
          ? <div className="task-form-hint">Assigned by <strong>{form.assignedBy}</strong></div>
          : <input className="form-input" placeholder="Your name (added by)" value={form.assignedBy || ''} onChange={f('assignedBy')} />
      )}
      <div className="task-form-images">
        {(form.attachments || []).length > 0 && (
          <div className="task-form-thumbs">
            {(form.attachments || []).map(att => {
              const isCover = form.cover?.attId === att.id
              return (
                <div key={att.id} className={`task-form-thumb${isCover ? ' is-cover' : ''}`}>
                  <a href={attSrc(att)} target="_blank" rel="noopener noreferrer" title={att.name}>
                    <img src={attSrc(att)} alt={att.name} />
                  </a>
                  <button type="button" className="task-form-thumb-cover" onClick={() => toggleCover(att)} title={isCover ? 'Unset cover' : 'Set as cover'}>{isCover ? '★' : '☆'}</button>
                  <button type="button" className="task-form-thumb-remove" onClick={() => removeImage(att.id)} title="Remove">✕</button>
                </div>
              )
            })}
          </div>
        )}
        <label className="task-form-image-add">
          + Add image
          <input type="file" accept="image/*" multiple onChange={e => { addImages(e.target.files); e.target.value = '' }} style={{ display: 'none' }} />
        </label>
      </div>
      <div className="task-form-row">
        <label className="task-form-date">
          <span className="task-form-date-label">Start</span>
          <input className="form-input" type="date" title="Start date" value={form.startDate} onChange={f('startDate')} />
        </label>
        <label className="task-form-date">
          <span className="task-form-date-label">End</span>
          <input className="form-input" type="date" title="End date" value={form.dueDate} onChange={f('dueDate')} />
        </label>
        {!quickAdd && (
          <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', alignItems: 'center' }}>
            {addAnotherBox}
            <button className="btn-ghost" type="button" onClick={onCancel} style={{ fontSize: 12 }}>Cancel</button>
            <SubmitButton className="btn-primary" onClick={submit} style={{ fontSize: 12 }} disabled={!form.title.trim() || labelMissing}>
              {label || 'Save'}
            </SubmitButton>
          </div>
        )}
      </div>
    </>
  )

  if (!quickAdd) {
    return (
      <div className="task-form" onKeyDown={onFormKeyDown}>
        <div className="task-form-row">
          <input ref={titleRef} className="form-input" placeholder={titlePlaceholder || 'Task title *'} value={form.title} onChange={f('title')} onKeyDown={onTitleKeyDown} autoFocus required />
          <input className="form-input task-num-input" placeholder="# override (e.g. 1.2.3)" value={form.numberOverride} onChange={f('numberOverride')} title="Custom number (leave blank for auto)" />
        </div>
        {advanced}
      </div>
    )
  }

  return (
    <div className="task-form task-form--quick" onKeyDown={onFormKeyDown}>
      <div className="task-quick-row">
        <span className="task-quick-arrow" aria-hidden="true">↳</span>
        <input
          ref={titleRef}
          className="form-input task-quick-input"
          placeholder={titlePlaceholder || 'Sub-task title…'}
          value={form.title}
          onChange={f('title')}
          onKeyDown={onTitleKeyDown}
          autoFocus
          required
        />
        <SubmitButton className="btn-primary task-quick-submit" onClick={submit} disabled={!form.title.trim() || labelMissing}>
          {label || 'Add'}
        </SubmitButton>
        <button className="btn-ghost task-quick-close" type="button" onClick={onCancel} title="Cancel (Esc)">✕</button>
      </div>
      {showLabelsInline && labelPicker}
      {expanded && <div className="task-quick-advanced">{advanced}</div>}
      <div className="task-quick-footer">
        <button className="task-quick-toggle" type="button" onClick={() => setExpanded(v => !v)} aria-expanded={expanded}>
          {expanded ? '⌃ Fewer options' : '⌄ More options'}
        </button>
        {addAnotherBox}
        <span className="task-quick-hint">Enter to add · Esc to close</span>
      </div>
    </div>
  )
}
