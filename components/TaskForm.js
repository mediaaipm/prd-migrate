import { useState, useRef } from 'react'
import AssigneeInput from './AssigneeInput'
import AutoTextarea from './AutoTextarea'
import SubmitButton from './SubmitButton'
import { attSrc } from '../lib/attachment-src'

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
  return { title: '', description: '', status: 'todo', priority: 'medium', category: '', assignees: [], assignedBy: '', startDate: '', dueDate: '', numberOverride: '', attachments: [], cover: null, labelIds: [] }
}

// The one task composer/editor. The list, the board and the board's modals all
// mount this, so "Add Task" asks for exactly the same fields wherever it is
// opened from.
//
// `quickAdd` collapses everything but the title behind a "More options" toggle — the
// common case is a title and Enter. `allowAddAnother` keeps the form open and cleared
// after a save so several sub-tasks can be typed in a row.
export default function TaskForm({ initial, onSave, onCancel, label, assignees = [], showCreator = false, currentUser = null, quickAdd = false, allowAddAnother = false, columns = [], categories = [], inheritedCategory = '', labels = [], requireLabel = false, titlePlaceholder }) {
  function makeInitial() {
    const base = initial || blankForm()
    // Auto-attribute the creator from the logged-in user; no manual entry.
    if (showCreator && !base.assignedBy && currentUser?.name) return { ...base, assignedBy: currentUser.name }
    return base
  }
  const [form, setForm] = useState(makeInitial)
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
    onSave({ ...form, assignees: assigneesFinal }, { keepOpen })
    if (!keepOpen) return
    // Keep the inherited defaults (status, priority, assignees, dates); clear what is
    // unique to the task just added.
    setForm(p => ({ ...p, title: '', description: '', numberOverride: '', attachments: [], cover: null }))
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

  const advanced = (
    <>
      {quickAdd && (
        <input className="form-input task-num-input" placeholder="# override (e.g. 1.2.3)" value={form.numberOverride} onChange={f('numberOverride')} title="Custom number (leave blank for auto)" />
      )}
      <AutoTextarea className="form-input task-desc-input" placeholder="Description (optional)" value={form.description} onChange={f('description')} />
      <div className="task-form-row">
        <select className="form-input" value={form.status} onChange={f('status')}>
          {columns.map(c => <option key={c.status} value={c.status}>{c.label}</option>)}
        </select>
        <select className="form-input" value={form.priority} onChange={f('priority')}>
          <option value="low">Low priority</option>
          <option value="medium">Medium priority</option>
          <option value="high">High priority</option>
          <option value="critical">Critical priority</option>
        </select>
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
