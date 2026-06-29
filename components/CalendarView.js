import { useState, useEffect } from 'react'
import { apiFetch } from '../lib/api-fetch'
import AssigneeInput from './AssigneeInput'
import TaskContextMenu from './TaskContextMenu'
import TaskHistoryModal from './TaskHistoryModal'

const PRIORITY_COLOR = { low: '#64748b', medium: '#f59e0b', high: '#dc2626', critical: '#9f1239' }
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const STATUSES = ['backlog', 'todo', 'in-progress', 'in-review', 'review', 'blocked', 'done']
const MAX_ATTACH_BYTES = 1024 * 1024 // 1MB cap per image (stored inline as data URL in Redis)

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function blankForm(dueDate) {
  return { title: '', description: '', status: 'todo', priority: 'medium', assignees: [], startDate: '', dueDate: dueDate || '', attachments: [], cover: null }
}

function DayTaskForm({ initial, onSave, onCancel, label, assignees }) {
  const [form, setForm] = useState(initial)
  const f = (k) => e => setForm(p => ({ ...p, [k]: e.target.value }))

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
    setForm(p => ({ ...p, cover: p.cover?.attId === att.id ? null : { dataUrl: att.dataUrl, attId: att.id } }))
  }

  return (
    <div className="task-form">
      <input className="form-input" placeholder="Task title *" value={form.title} onChange={f('title')} autoFocus />
      <textarea className="form-input task-desc-input" placeholder="Description (optional)" value={form.description} onChange={f('description')} rows={2} />
      <div className="task-form-row">
        <select className="form-input" value={form.status} onChange={f('status')}>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="form-input" value={form.priority} onChange={f('priority')}>
          <option value="low">Low priority</option>
          <option value="medium">Medium priority</option>
          <option value="high">High priority</option>
          <option value="critical">Critical priority</option>
        </select>
      </div>
      <AssigneeInput value={form.assignees} options={assignees} onChange={next => setForm(p => ({ ...p, assignees: next }))} />
      <div className="task-form-images">
        {(form.attachments || []).length > 0 && (
          <div className="task-form-thumbs">
            {(form.attachments || []).map(att => {
              const isCover = form.cover?.attId === att.id
              return (
                <div key={att.id} className={`task-form-thumb${isCover ? ' is-cover' : ''}`}>
                  <a href={att.dataUrl} target="_blank" rel="noopener noreferrer" title={att.name}>
                    <img src={att.dataUrl} alt={att.name} />
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
        <input className="form-input" type="date" title="Start date" value={form.startDate} onChange={f('startDate')} />
        <input className="form-input" type="date" title="Due date" value={form.dueDate} onChange={f('dueDate')} />
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          <button className="btn-ghost" type="button" onClick={onCancel} style={{ fontSize: 12 }}>Cancel</button>
          <button className="btn-primary" type="button" onClick={() => form.title.trim() && onSave(form)} style={{ fontSize: 12 }} disabled={!form.title.trim()}>
            {label || 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dueKey(task) {
  if (!task.dueDate) return null
  // Tasks store ISO or yyyy-mm-dd — normalize to yyyy-mm-dd local.
  const d = new Date(task.dueDate)
  if (isNaN(d)) return null
  return ymd(d)
}

export default function CalendarView({ tasks, apiBase, onRefresh, currentUser }) {
  const today = new Date()
  const [ctxMenu, setCtxMenu] = useState(null)   // { x, y, task }
  const [historyTask, setHistoryTask] = useState(null)
  const isAdmin = !!currentUser?.isAdmin
  function handleTaskContextMenu(e, task) {
    if (!isAdmin) return
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({ x: e.clientX, y: e.clientY, task })
  }
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1))
  const [dragId, setDragId] = useState(null)
  const [dragOverDay, setDragOverDay] = useState(null)
  const [openDay, setOpenDay] = useState(null)   // ymd string of day modal
  const [editId, setEditId] = useState(null)     // task id being edited, or 'new'
  const [subParent, setSubParent] = useState(null) // parent task when adding a sub-task
  const [assignees, setAssignees] = useState([])

  useEffect(() => {
    fetch('/api/assignees').then(r => r.ok ? r.json() : []).then(setAssignees).catch(() => {})
  }, [])

  const boardTasks = (tasks || []).filter(t => !t.archived)
  const byDay = {}
  for (const t of boardTasks) {
    const k = dueKey(t)
    if (k) (byDay[k] = byDay[k] || []).push(t)
  }
  const unscheduled = boardTasks.filter(t => !t.dueDate)

  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const firstDow = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const cells = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d))
  while (cells.length % 7 !== 0) cells.push(null)

  async function reschedule(taskId, dateStr) {
    await apiFetch(`${apiBase}/${taskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dueDate: dateStr }),
    })
    onRefresh()
  }

  function onDrop(dateStr) {
    if (dragId) reschedule(dragId, dateStr)
    setDragId(null)
    setDragOverDay(null)
  }

  function closeForm() {
    setEditId(null)
    setSubParent(null)
  }

  async function saveTask(form) {
    if (editId === 'new') {
      await apiFetch(apiBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title, description: form.description, status: form.status,
          priority: form.priority, assignees: form.assignees || [],
          startDate: form.startDate || null, dueDate: form.dueDate || null, parentId: subParent || null,
          attachments: form.attachments || [], cover: form.cover || null,
        }),
      })
    } else {
      await apiFetch(`${apiBase}/${editId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title, description: form.description, status: form.status,
          priority: form.priority, assignees: form.assignees || [],
          startDate: form.startDate || null, dueDate: form.dueDate || null,
          attachments: form.attachments || [], cover: form.cover || null,
        }),
      })
    }
    closeForm()
    onRefresh()
  }

  async function deleteTask(id) {
    if (!confirm('Delete this task?')) return
    await apiFetch(`${apiBase}/${id}`, { method: 'DELETE' })
    onRefresh()
  }

  const todayKey = ymd(today)
  const openDayTasks = openDay ? (byDay[openDay] || []) : []

  // Group children directly under their parent when both are due the same day;
  // children whose parent isn't in this day's list render as their own row.
  function orderDayTasks(list) {
    const ids = new Set(list.map(t => t.id))
    const childrenOf = {}
    for (const t of list) {
      if (t.parentId && ids.has(t.parentId)) (childrenOf[t.parentId] = childrenOf[t.parentId] || []).push(t)
    }
    const rows = []
    for (const t of list) {
      if (t.parentId && ids.has(t.parentId)) continue // emitted under its parent
      rows.push({ task: t, isChild: false })
      for (const c of (childrenOf[t.id] || [])) rows.push({ task: c, isChild: true })
    }
    return rows
  }

  return (
    <div className="cal-view">
      <div className="cal-toolbar">
        <button className="btn-ghost" onClick={() => setCursor(new Date(year, month - 1, 1))}>‹ Prev</button>
        <span className="cal-title">{MONTHS[month]} {year}</span>
        <button className="btn-ghost" onClick={() => setCursor(new Date(year, month + 1, 1))}>Next ›</button>
        <button className="btn-ghost" onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))}>Today</button>
      </div>

      <div className="cal-grid cal-grid--head">
        {WEEKDAYS.map(w => <div key={w} className="cal-weekday">{w}</div>)}
      </div>
      <div className="cal-grid">
        {cells.map((date, i) => {
          if (!date) return <div key={`e${i}`} className="cal-cell cal-cell--empty" />
          const k = ymd(date)
          const items = byDay[k] || []
          return (
            <div
              key={k}
              className={`cal-cell${k === todayKey ? ' cal-cell--today' : ''}${dragOverDay === k ? ' cal-cell--drag-over' : ''}`}
              onDragOver={e => { if (dragId) { e.preventDefault(); setDragOverDay(k) } }}
              onDrop={e => { e.preventDefault(); onDrop(k) }}
              onClick={() => { setOpenDay(k); setEditId(null) }}
              style={{ cursor: 'pointer' }}
              title="Click to edit tasks"
            >
              <div className="cal-cell-date">{date.getDate()}</div>
              <div className="cal-cell-items">
                {items.map(t => (
                  <div
                    key={t.id}
                    className="cal-task"
                    draggable
                    onContextMenu={e => handleTaskContextMenu(e, t)}
                    onDragStart={e => { e.stopPropagation(); setDragId(t.id) }}
                    onDragEnd={() => { setDragId(null); setDragOverDay(null) }}
                    onClick={e => { e.stopPropagation(); setOpenDay(k); setEditId(t.id) }}
                    title={t.title}
                    style={{ borderLeftColor: PRIORITY_COLOR[t.priority] || '#64748b' }}
                  >
                    {t.cover?.dataUrl && <img src={t.cover.dataUrl} alt="" className="cal-task-cover" />}
                    {t.number && <span className="cal-task-num">#{t.number}</span>}
                    <span className={t.status === 'done' ? 'cal-task-done' : ''}>{t.title}</span>
                    {!t.cover?.dataUrl && Array.isArray(t.attachments) && t.attachments.length > 0 && <span className="cal-task-attach" title={`${t.attachments.length} image(s)`}>🖼</span>}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {unscheduled.length > 0 && (
        <div className="cal-unscheduled">
          <div className="cal-unscheduled-title">Unscheduled ({unscheduled.length}) — drag onto a day to set a due date</div>
          <div className="cal-unscheduled-list">
            {unscheduled.map(t => (
              <div
                key={t.id}
                className="cal-task cal-task--chip"
                draggable
                onContextMenu={e => handleTaskContextMenu(e, t)}
                onDragStart={() => setDragId(t.id)}
                onDragEnd={() => { setDragId(null); setDragOverDay(null) }}
                style={{ borderLeftColor: PRIORITY_COLOR[t.priority] || '#64748b' }}
              >
                {t.number && <span className="cal-task-num">#{t.number}</span>}
                {t.title}
              </div>
            ))}
          </div>
        </div>
      )}

      {openDay && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
          onClick={e => { if (e.target === e.currentTarget) { setOpenDay(null); closeForm() } }}
        >
          <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 520, boxShadow: '0 20px 60px rgba(0,0,0,.18)', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>{new Date(openDay + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
              <button onClick={() => { setOpenDay(null); closeForm() }} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#94a3b8', lineHeight: 1 }}>×</button>
            </div>
            <div style={{ padding: '16px 22px', overflowY: 'auto' }}>
              {editId && editId !== 'new' ? (
                (() => {
                  const t = openDayTasks.find(x => x.id === editId)
                  if (!t) return null
                  const ta = Array.isArray(t.assignees) ? t.assignees : (t.assignee ? [t.assignee] : [])
                  return (
                    <DayTaskForm
                      initial={{ title: t.title, description: t.description || '', status: t.status || 'todo', priority: t.priority || 'medium', assignees: ta, startDate: t.startDate || '', dueDate: t.dueDate || openDay, attachments: Array.isArray(t.attachments) ? t.attachments : [], cover: t.cover || null }}
                      onSave={saveTask}
                      onCancel={closeForm}
                      label="Update"
                      assignees={assignees}
                    />
                  )
                })()
              ) : editId === 'new' ? (
                <>
                  {subParent && (
                    <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 10px' }}>
                      Sub-task of <strong>{boardTasks.find(x => x.id === subParent)?.title || 'task'}</strong>
                    </p>
                  )}
                  <DayTaskForm
                    initial={blankForm(openDay)}
                    onSave={saveTask}
                    onCancel={closeForm}
                    label={subParent ? 'Add Sub-task' : 'Add Task'}
                    assignees={assignees}
                  />
                </>
              ) : (
                <>
                  {openDayTasks.length === 0 ? (
                    <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 14px' }}>No tasks due this day.</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                      {orderDayTasks(openDayTasks).map(({ task: t, isChild }) => (
                        <div key={t.id} onContextMenu={e => handleTaskContextMenu(e, t)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, borderLeft: `3px solid ${PRIORITY_COLOR[t.priority] || '#64748b'}`, marginLeft: isChild ? 18 : 0 }}>
                          {isChild && <span style={{ color: '#94a3b8', fontSize: 12 }}>↳</span>}
                          {t.cover?.dataUrl && <img src={t.cover.dataUrl} alt="" style={{ width: 28, height: 28, objectFit: 'cover', borderRadius: 5, border: '1px solid var(--border)' }} />}
                          {t.number && <span style={{ fontSize: 11, color: '#94a3b8' }}>#{t.number}</span>}
                          <span style={{ flex: 1, fontSize: 13, textDecoration: t.status === 'done' ? 'line-through' : 'none' }}>{t.title}</span>
                          {!t.cover?.dataUrl && Array.isArray(t.attachments) && t.attachments.length > 0 && <span style={{ fontSize: 11 }} title={`${t.attachments.length} image(s)`}>🖼 {t.attachments.length}</span>}
                          <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 10, background: '#f1f5f9', color: '#475569' }}>{t.status}</span>
                          {!isChild && <button className="btn-ghost" style={{ fontSize: 12, padding: '3px 8px' }} title="Add sub-task" onClick={() => { setSubParent(t.id); setEditId('new') }}>+ sub</button>}
                          <button className="btn-ghost" style={{ fontSize: 12, padding: '3px 10px' }} onClick={() => setEditId(t.id)}>Edit</button>
                          <button className="btn-ghost" style={{ fontSize: 12, padding: '3px 8px', color: '#dc2626' }} onClick={() => deleteTask(t.id)}>✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <button className="btn-primary" style={{ fontSize: 13, padding: '7px 16px' }} onClick={() => { setSubParent(null); setEditId('new') }}>+ Add task on this day</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {ctxMenu && (
        <TaskContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          items={[{ label: 'View activity / history', icon: '🕑', onClick: () => setHistoryTask(ctxMenu.task) }]}
        />
      )}
      {historyTask && (
        <TaskHistoryModal
          apiBase={apiBase}
          task={historyTask}
          label={historyTask.number ? `#${historyTask.number}` : ''}
          onClose={() => setHistoryTask(null)}
        />
      )}
    </div>
  )
}
