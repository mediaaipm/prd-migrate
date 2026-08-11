import { useState, useEffect } from 'react'
import { CAT_COLORS, STARTER_CATEGORIES, categorySlug, saveCategories, categoriesWithTaskValues } from '../lib/categories'
import { isSuperAdmin } from '../lib/client-permissions'

// Manage the project's category list — the middle axis of the board (story lane ›
// category rail › status column). Owned by super admins, same as board columns;
// everyone else sees it read-only.
//
// Order in this list is rail order on the board, so the up/down buttons are the
// layout control, not a cosmetic sort.
export default function CategoryManager({ slug, categories, tasks = [], currentUser, onClose }) {
  const canEdit = isSuperAdmin(currentUser)
  // Mirror the server copy so an edit paints immediately, then reverts if the PUT
  // is rejected — the same optimistic pattern the column editor uses.
  const [draft, setDraft] = useState(categories)
  const [error, setError] = useState('')
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(CAT_COLORS[0])

  useEffect(() => { setDraft(categories) }, [categories])

  // Tasks that name a category id that is no longer defined. They stay visible on
  // the board via categoriesWithTaskValues(); this is where they get cleaned up.
  const withOrphans = categoriesWithTaskValues(draft, tasks)
  const orphans = withOrphans.filter(c => c.orphan)

  function countFor(id) {
    return (tasks || []).filter(t => !t.archived && t.category === id).length
  }

  function commit(next) {
    const before = draft
    setDraft(next)
    setError('')
    saveCategories(slug, next).catch(err => {
      setError(err.message || 'Could not save categories')
      setDraft(before)
    })
  }

  function addCategory() {
    const name = newName.trim()
    if (!name) return
    const id = categorySlug(name, draft.map(c => c.id))
    commit([...draft, { id, name, color: newColor }])
    setNewName('')
    setNewColor(CAT_COLORS[(draft.length + 1) % CAT_COLORS.length])
  }

  function addStarterSet() {
    const have = new Set(draft.map(c => c.id))
    const missing = STARTER_CATEGORIES.filter(c => !have.has(c.id))
    if (missing.length) commit([...draft, ...missing])
  }

  function rename(id, name) {
    // Only `name` changes — `id` is what tasks store, so a rename must never
    // touch a single task.
    commit(draft.map(c => (c.id === id ? { ...c, name } : c)))
  }

  function recolor(id, color) {
    commit(draft.map(c => (c.id === id ? { ...c, color } : c)))
  }

  function move(id, dir) {
    const i = draft.findIndex(c => c.id === id)
    const j = i + dir
    if (i === -1 || j < 0 || j >= draft.length) return
    const next = [...draft]
    ;[next[i], next[j]] = [next[j], next[i]]
    commit(next)
  }

  function remove(id) {
    const n = countFor(id)
    const cat = draft.find(c => c.id === id)
    // Deleting never cascades to tasks — they keep the id and resurface in a
    // flagged rail, the same rescue a task keeps when its column is deleted.
    const msg = n > 0
      ? `Delete "${cat?.name || id}"? ${n} task(s) still use it. They keep their work but land in an unconfigured rail until you reassign them.`
      : `Delete "${cat?.name || id}"?`
    if (!confirm(msg)) return
    commit(draft.filter(c => c.id !== id))
  }

  function clearOrphan(id) {
    const n = countFor(id)
    if (!confirm(`Clear the "${id}" category from ${n} task(s)? They move to Uncategorised.`)) return
    // Left to the caller: this only re-adds the definition so the tasks can be
    // re-filed. Bulk-clearing the field on every task is a task write, not a
    // category write, and belongs to whoever owns those tasks.
    commit([...draft, { id, name: id, color: CAT_COLORS[draft.length % CAT_COLORS.length] }])
  }

  return (
    <div className="kanban-modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="kanban-modal" style={{ maxWidth: 480 }}>
        <div className="kanban-modal-header">
          <span>Categories</span>
          <button className="kanban-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="task-form">
          <div className="task-form-hint">
            A category groups work <em>within</em> a story — Frontend, Backend, UI/UX. It is a field on
            the task, so one “Backend” serves every story and can be filtered across the project.
            This order is the rail order on the board.
          </div>

          {error && <div className="kanban-col-error">{error}</div>}

          <div className="kanban-label-mgr-list">
            {draft.length === 0 && (
              <div className="kanban-empty" style={{ margin: 0 }}>
                No categories yet{canEdit ? ' — add one below, or start from the common set.' : '.'}
              </div>
            )}
            {draft.map((c, i) => (
              <div key={c.id} className="kanban-label-mgr-row">
                {canEdit ? (
                  <>
                    <span className="cat-mgr-order">
                      <button className="task-action-btn task-action-btn--move" onClick={() => move(c.id, -1)} disabled={i === 0} title="Move up">↑</button>
                      <button className="task-action-btn task-action-btn--move" onClick={() => move(c.id, 1)} disabled={i === draft.length - 1} title="Move down">↓</button>
                    </span>
                    <input
                      className="form-input cat-mgr-name"
                      value={c.name}
                      onChange={e => rename(c.id, e.target.value)}
                      title={`id: ${c.id} (never changes)`}
                    />
                    <div className="kanban-col-color-picker" style={{ flex: 1 }}>
                      {CAT_COLORS.map(col => (
                        <button
                          key={col}
                          className={`kanban-col-color-swatch${c.color === col ? ' active' : ''}`}
                          style={{ background: col }}
                          onClick={() => recolor(c.id, col)}
                          title={col}
                        />
                      ))}
                    </div>
                    <span className="cat-mgr-count" title="Tasks with this category set directly">{countFor(c.id)}</span>
                    <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => remove(c.id)} title="Delete category">✕</button>
                  </>
                ) : (
                  <>
                    <span className="task-cat-chip" style={{ background: c.color }}>{c.name}</span>
                    <span className="cat-mgr-count" style={{ marginLeft: 'auto' }}>{countFor(c.id)}</span>
                  </>
                )}
              </div>
            ))}
          </div>

          {orphans.length > 0 && (
            <div className="cat-mgr-orphans">
              <div className="task-assignees-label">Not defined here</div>
              {orphans.map(o => (
                <div key={o.id} className="kanban-label-mgr-row">
                  <span className="task-cat-chip task-cat-chip--orphan">{o.id}</span>
                  <span className="cat-mgr-count">{countFor(o.id)} task(s)</span>
                  {canEdit && (
                    <button className="btn-ghost" style={{ fontSize: 12, marginLeft: 'auto' }} onClick={() => clearOrphan(o.id)}>
                      Re-add
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {canEdit && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 4 }}>
              <input
                className="form-input"
                placeholder="New category name"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addCategory() }}
              />
              <div className="kanban-col-color-picker" style={{ marginTop: 8 }}>
                {CAT_COLORS.map(col => (
                  <button
                    key={col}
                    className={`kanban-col-color-swatch${newColor === col ? ' active' : ''}`}
                    style={{ background: col }}
                    onClick={() => setNewColor(col)}
                    title={col}
                  />
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <button className="btn-primary" style={{ fontSize: 12 }} onClick={addCategory} disabled={!newName.trim()}>
                  + Add category
                </button>
                {draft.length === 0 && (
                  <button className="btn-ghost" style={{ fontSize: 12 }} onClick={addStarterSet} title="Frontend, Backend, UI/UX, QA, Data Entry">
                    Use the common set
                  </button>
                )}
              </div>
            </div>
          )}

          {!canEdit && (
            <div className="task-form-hint">Only a super admin can change the category list.</div>
          )}
        </div>
      </div>
    </div>
  )
}
