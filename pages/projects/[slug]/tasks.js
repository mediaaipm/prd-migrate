import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import Nav from '../../../components/Nav'
import { apiFetch } from '../../../lib/api-fetch'
import TaskTree from '../../../components/TaskTree'
import KanbanBoard from '../../../components/KanbanBoard'
import CalendarView from '../../../components/CalendarView'

// ─── Active Sprint ────────────────────────────────────────────────────────────

function SprintProgressBar({ done, total }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const color = pct === 100 ? '#15803d' : pct >= 60 ? '#1d4ed8' : pct >= 30 ? '#d97706' : '#7c3aed'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
      <div style={{ flex: 1, height: 8, background: '#e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 8, transition: 'width .4s ease', minWidth: pct > 0 ? 6 : 0 }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color, whiteSpace: 'nowrap' }}>{done}/{total}</span>
    </div>
  )
}

function SprintTaskChip({ task, sub }) {
  const isDone = task.status === 'done'
  const isInProgress = task.status === 'in-progress'
  const dotColor = isDone ? '#15803d' : isInProgress ? '#1d4ed8' : '#94a3b8'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: sub ? '2px 8px' : '3px 10px',
      borderRadius: 20,
      fontSize: sub ? 11 : 12,
      fontWeight: 500,
      background: isDone ? '#f0fdf4' : isInProgress ? '#eff6ff' : '#f8fafc',
      color: isDone ? '#15803d' : isInProgress ? '#1d4ed8' : '#475569',
      border: `1px solid ${isDone ? '#bbf7d0' : isInProgress ? '#bfdbfe' : '#e2e8f0'}`,
      textDecoration: isDone ? 'line-through' : 'none',
      whiteSpace: 'nowrap',
      opacity: sub ? 0.9 : 1,
    }}>
      <span style={{ width: sub ? 5 : 7, height: sub ? 5 : 7, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
      {task.number && <span style={{ fontSize: sub ? 9 : 10, color: '#94a3b8' }}>#{task.number}</span>}
      {task.title}
    </span>
  )
}

function SprintChips({ tasks, sprintIdSet }) {
  const topItems = tasks.filter(t => !t.parentId || !sprintIdSet.has(t.parentId))
  function chain(task) {
    return [task, ...tasks.filter(t => t.parentId === task.id).flatMap(chain)]
  }
  const groups = topItems.map(chain)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {groups.map(group =>
        <div key={group[0].id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
          {group.flatMap((t, i) => [
            i > 0 ? <span key={`sep-${t.id}`} style={{ color: '#cbd5e1', fontSize: 12, userSelect: 'none' }}>›</span> : null,
            <SprintTaskChip key={t.id} task={t} sub={i > 0} />,
          ]).filter(Boolean)}
        </div>
      )}
    </div>
  )
}


function formatSprintDate(d) {
  if (!d) return null
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function daysLeft(endDate) {
  if (!endDate) return null
  const diff = Math.ceil((new Date(endDate).setHours(23, 59, 59, 999) - Date.now()) / 86400000)
  return diff
}

function SprintsSection({ slug, tasks: allTasks, onSprintChange, refreshTrigger }) {
  const [sprints, setSprints]             = useState([])
  const [loadingS, setLoadingS]           = useState(true)
  const [showModal, setShowModal]         = useState(false)
  const [editingSprint, setEditingSprint] = useState(null)
  const [acting, setActing]               = useState(null)
  const [showCompleted, setShowCompleted] = useState(false)

  const [formName, setFormName]       = useState('')
  const [formStart, setFormStart]     = useState('')
  const [formEnd, setFormEnd]         = useState('')
  const [formTaskIds, setFormTaskIds] = useState([])
  const [formStatus, setFormStatus]   = useState('active')

  const loadSprints = useCallback(() => {
    if (!slug) return
    apiFetch(`/api/projects/${slug}/sprint`)
      .then(r => r.ok ? r.json() : [])
      .then(data => { setSprints(Array.isArray(data) ? data : []); setLoadingS(false) })
      .catch(() => setLoadingS(false))
  }, [slug])

  useEffect(() => { loadSprints() }, [loadSprints])
  useEffect(() => { if (refreshTrigger > 0) loadSprints() }, [refreshTrigger]) // eslint-disable-line react-hooks/exhaustive-deps

  function openNew() {
    setEditingSprint(null)
    setFormName(''); setFormStart(''); setFormEnd(''); setFormTaskIds([]); setFormStatus('active')
    setShowModal(true)
  }

  function openEdit(sprint) {
    setEditingSprint(sprint)
    setFormName(sprint.name || '')
    setFormStart(sprint.startDate || '')
    setFormEnd(sprint.endDate || '')
    setFormTaskIds(sprint.taskIds || [])
    setFormStatus(sprint.status || 'active')
    setShowModal(true)
  }

  async function handleSave(e) {
    e.preventDefault()
    const body = { name: formName, startDate: formStart || null, endDate: formEnd || null, taskIds: formTaskIds, status: formStatus }
    if (editingSprint) {
      await apiFetch(`/api/projects/${slug}/sprint?id=${editingSprint.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
    } else {
      await apiFetch(`/api/projects/${slug}/sprint`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
    }
    setShowModal(false)
    loadSprints()
    onSprintChange?.()
  }

  async function completeSprint(sprint) {
    if (!confirm(`Mark "${sprint.name}" as completed?`)) return
    setActing(sprint.id)
    await apiFetch(`/api/projects/${slug}/sprint?id=${sprint.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: sprint.name, startDate: sprint.startDate, endDate: sprint.endDate, taskIds: sprint.taskIds, status: 'completed' }),
    })
    setActing(null)
    loadSprints(); onSprintChange?.()
  }

  async function handleDelete(sprint) {
    if (!confirm(`Delete "${sprint.name}"? This cannot be undone.`)) return
    setActing(sprint.id)
    await apiFetch(`/api/projects/${slug}/sprint?id=${sprint.id}`, { method: 'DELETE' })
    setActing(null)
    loadSprints(); onSprintChange?.()
  }

  async function startSprint(sprint) {
    setActing(sprint.id)
    await apiFetch(`/api/projects/${slug}/sprint?id=${sprint.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: sprint.name, startDate: sprint.startDate, endDate: sprint.endDate, taskIds: sprint.taskIds, status: 'active' }),
    })
    setActing(null)
    loadSprints(); onSprintChange?.()
  }

  function toggleTask(id) {
    setFormTaskIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const rootTasks = (allTasks || []).filter(t => !t.parentId)
  const subtasksByParent = (allTasks || []).reduce((acc, t) => {
    if (t.parentId) { acc[t.parentId] = acc[t.parentId] || []; acc[t.parentId].push(t) }
    return acc
  }, {})

  function countDescendants(taskId) {
    const kids = subtasksByParent[taskId] || []
    return kids.reduce((n, k) => n + 1 + countDescendants(k.id), 0)
  }
  function countSelectedDescendants(taskId) {
    const kids = subtasksByParent[taskId] || []
    return kids.reduce((n, k) => n + (formTaskIds.includes(k.id) ? 1 : 0) + countSelectedDescendants(k.id), 0)
  }

  function renderTaskRow(t, depth) {
    const d = depth || 0
    const children = subtasksByParent[t.id] || []
    const totalDesc = countDescendants(t.id)
    const selDesc = countSelectedDescendants(t.id)
    const bgColors = ['#fff', '#fafafa', '#f7f7fb', '#f4f4f9']
    const bgSelected = ['#eef2ff', '#f5f3ff', '#f0eeff', '#ece9ff']
    const indentPx = 14 + d * 18
    return (
      <div key={t.id}>
        <label style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: `7px 14px 7px ${indentPx}px`,
          borderBottom: '1px solid var(--border)',
          cursor: 'pointer', fontSize: d === 0 ? 13 : 12,
          background: formTaskIds.includes(t.id) ? (bgSelected[Math.min(d, bgSelected.length - 1)]) : (bgColors[Math.min(d, bgColors.length - 1)]),
          transition: 'background .1s',
        }}>
          {d > 0 && <span style={{ fontSize: 9, color: '#94a3b8', flexShrink: 0 }}>↳</span>}
          <input type="checkbox" checked={formTaskIds.includes(t.id)} onChange={() => toggleTask(t.id)} style={{ flexShrink: 0 }} />
          {t.number && <span style={{ fontSize: d === 0 ? 11 : 10, color: '#94a3b8', flexShrink: 0 }}>#{t.number}</span>}
          <span style={{ flex: 1, fontWeight: d === 0 ? 600 : 400, color: 'var(--text)', textDecoration: t.status === 'done' ? 'line-through' : 'none' }}>{t.title}</span>
          {totalDesc > 0 && <span style={{ fontSize: 10, color: '#94a3b8', flexShrink: 0 }}>{selDesc}/{totalDesc}</span>}
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 10, flexShrink: 0,
            background: t.status === 'done' ? '#f0fdf4' : t.status === 'in-progress' ? '#eff6ff' : '#f1f5f9',
            color: t.status === 'done' ? '#15803d' : t.status === 'in-progress' ? '#1d4ed8' : '#475569',
          }}>{t.status}</span>
        </label>
        {children.map(c => renderTaskRow(c, d + 1))}
      </div>
    )
  }

  const activeSprints   = sprints.filter(s => s.status === 'active')
  const plannedSprints  = sprints.filter(s => s.status === 'planned')
  const completedSprints = sprints.filter(s => s.status === 'completed')

  if (loadingS) return null

  return (
    <>
      {/* Active sprint banners */}
      {activeSprints.map(sprint => {
        const sprintIdSet  = new Set(sprint.taskIds || [])
        const allItems     = sprint.tasks || []
        const doneTasks    = allItems.filter(t => t.status === 'done').length
        const remaining = daysLeft(sprint.endDate)
        const isOverdue = remaining !== null && remaining < 0
        return (
          <div key={sprint.id} style={{
            border: '1px solid #c7d2fe', borderRadius: 12,
            background: 'linear-gradient(135deg, #eef2ff 0%, #f0fdf4 100%)',
            padding: '16px 20px', marginBottom: 10,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: allItems.length > 0 ? 12 : 0 }}>
              <span style={{ fontSize: 16 }}>⚡</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#312e81' }}>Active Sprint:</span>
              <span style={{ fontSize: 14, fontWeight: 800, color: '#4338ca' }}>{sprint.name}</span>
              {(sprint.startDate || sprint.endDate) && (
                <span style={{ fontSize: 12, color: '#6b7280' }}>
                  {formatSprintDate(sprint.startDate)}{sprint.startDate && sprint.endDate ? ' – ' : ''}{formatSprintDate(sprint.endDate)}
                </span>
              )}
              {remaining !== null && (
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                  background: isOverdue ? '#fef2f2' : remaining <= 2 ? '#fffbeb' : '#f0fdf4',
                  color: isOverdue ? '#dc2626' : remaining <= 2 ? '#d97706' : '#15803d',
                  border: `1px solid ${isOverdue ? '#fecaca' : remaining <= 2 ? '#fde68a' : '#bbf7d0'}`,
                }}>
                  {isOverdue ? `${Math.abs(remaining)}d overdue` : remaining === 0 ? 'Ends today' : `${remaining}d left`}
                </span>
              )}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button onClick={() => openEdit(sprint)} style={{
                  padding: '5px 12px', borderRadius: 7, border: '1px solid #c7d2fe',
                  background: '#fff', color: '#4338ca', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}>Manage</button>
                <button onClick={() => completeSprint(sprint)} disabled={acting === sprint.id} style={{
                  padding: '5px 12px', borderRadius: 7, border: '1px solid #bbf7d0',
                  background: '#fff', color: '#15803d', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}>Complete</button>
                <button onClick={() => handleDelete(sprint)} disabled={acting === sprint.id} style={{
                  padding: '5px 12px', borderRadius: 7, border: '1px solid #fecaca',
                  background: '#fff', color: '#dc2626', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}>Delete</button>
              </div>
            </div>
            {allItems.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <SprintProgressBar done={doneTasks} total={allItems.length} />
              </div>
            )}
            {allItems.length > 0 && (
              <SprintChips tasks={allItems} sprintIdSet={sprintIdSet} />
            )}
            {allItems.length === 0 && (
              <p style={{ fontSize: 12, color: '#94a3b8', margin: 0 }}>
                No tasks in this sprint yet — click <strong>Manage</strong> to add some.
              </p>
            )}
          </div>
        )
      })}

      {/* Planned sprints */}
      {plannedSprints.length > 0 && (
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, background: '#f8fafc', padding: '12px 16px', marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', letterSpacing: '0.05em', marginBottom: 8 }}>PLANNED</div>
          {plannedSprints.map((sprint, i) => {
            const sprintIdSet = new Set(sprint.taskIds || [])
            const allItems    = sprint.tasks || []
            return (
              <div key={sprint.id} style={{
                padding: '8px 0', borderBottom: i < plannedSprints.length - 1 ? '1px solid #e2e8f0' : 'none',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14 }}>📋</span>
                  <span style={{ fontWeight: 700, fontSize: 13, color: '#1e293b' }}>{sprint.name}</span>
                  {(sprint.startDate || sprint.endDate) && (
                    <span style={{ fontSize: 12, color: '#64748b' }}>
                      {formatSprintDate(sprint.startDate)}{sprint.startDate && sprint.endDate ? ' – ' : ''}{formatSprintDate(sprint.endDate)}
                    </span>
                  )}
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>{allItems.length} tasks</span>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    <button onClick={() => startSprint(sprint)} disabled={acting === sprint.id} style={{
                      padding: '4px 10px', borderRadius: 6, border: '1px solid #6366f1',
                      background: '#6366f1', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    }}>▶ Start</button>
                    <button onClick={() => openEdit(sprint)} style={{
                      padding: '4px 10px', borderRadius: 6, border: '1px solid #e2e8f0',
                      background: '#fff', color: '#475569', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    }}>Edit</button>
                    <button onClick={() => handleDelete(sprint)} disabled={acting === sprint.id} style={{
                      padding: '4px 10px', borderRadius: 6, border: '1px solid #fecaca',
                      background: '#fff', color: '#dc2626', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    }}>Delete</button>
                  </div>
                </div>
                {allItems.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <SprintChips tasks={allItems} sprintIdSet={sprintIdSet} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Completed sprints */}
      {completedSprints.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <button onClick={() => setShowCompleted(v => !v)} style={{
            background: 'none', border: 'none', cursor: 'pointer', fontSize: 12,
            color: '#64748b', fontWeight: 600, padding: '4px 0', display: 'flex', alignItems: 'center', gap: 6,
          }}>
            {showCompleted ? '▾' : '▸'} Completed sprints ({completedSprints.length})
          </button>
          {showCompleted && (
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, background: '#f8fafc', padding: '10px 14px', marginTop: 6 }}>
              {completedSprints.map((sprint, i) => {
                const sprintIdSet = new Set(sprint.taskIds || [])
                const allItems    = sprint.tasks || []
                const doneTasks   = allItems.filter(t => t.status === 'done').length
                return (
                  <div key={sprint.id} style={{
                    padding: '7px 0', borderBottom: i < completedSprints.length - 1 ? '1px solid #e2e8f0' : 'none',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13 }}>✓</span>
                      <span style={{ fontWeight: 700, fontSize: 13, color: '#1e293b' }}>{sprint.name}</span>
                      {(sprint.startDate || sprint.endDate) && (
                        <span style={{ fontSize: 12, color: '#64748b' }}>
                          {formatSprintDate(sprint.startDate)}{sprint.startDate && sprint.endDate ? ' – ' : ''}{formatSprintDate(sprint.endDate)}
                        </span>
                      )}
                      <span style={{ fontSize: 12, color: '#15803d', fontWeight: 600 }}>{doneTasks}/{allItems.length} done</span>
                      <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                        <button onClick={() => handleDelete(sprint)} disabled={acting === sprint.id} style={{
                          padding: '3px 8px', borderRadius: 6, border: '1px solid #fecaca',
                          background: '#fff', color: '#dc2626', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                        }}>Delete</button>
                      </div>
                    </div>
                    {allItems.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <SprintChips tasks={allItems} sprintIdSet={sprintIdSet} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {sprints.length === 0 && (
        <div style={{
          border: '1px solid #c7d2fe', borderRadius: 12,
          background: 'linear-gradient(135deg, #eef2ff 0%, #f0fdf4 100%)',
          padding: '16px 20px', marginBottom: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18 }}>⚡</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#475569' }}>No sprints yet</span>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>— Create a sprint to track focused work</span>
          </div>
          <button onClick={openNew} style={{
            padding: '6px 14px', borderRadius: 8, border: '1px solid #6366f1',
            background: '#6366f1', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
          }}>+ New Sprint</button>
        </div>
      )}

      {/* New sprint button (when sprints exist) */}
      {sprints.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
          <button onClick={openNew} style={{
            padding: '5px 14px', borderRadius: 8, border: '1px solid #6366f1',
            background: '#fff', color: '#6366f1', fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}>+ New Sprint</button>
        </div>
      )}

      {/* Create / Edit modal */}
      {showModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
        }} onClick={e => { if (e.target === e.currentTarget) setShowModal(false) }}>
          <div style={{
            background: '#fff', borderRadius: 14, width: '100%', maxWidth: 520,
            boxShadow: '0 20px 60px rgba(0,0,0,.18)', maxHeight: '90vh', display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>{editingSprint ? 'Edit Sprint' : 'New Sprint'}</h2>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#94a3b8', lineHeight: 1 }}>×</button>
            </div>
            <form onSubmit={handleSave} style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto' }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 5 }}>Sprint Name *</label>
                <input value={formName} onChange={e => setFormName(e.target.value)} placeholder="e.g. Sprint 3" required
                  style={{ width: '100%', padding: '8px 11px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 5 }}>Status</label>
                <select value={formStatus} onChange={e => setFormStatus(e.target.value)}
                  style={{ width: '100%', padding: '8px 11px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, boxSizing: 'border-box' }}>
                  <option value="active">Active</option>
                  <option value="planned">Planned</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 5 }}>Start Date</label>
                  <input type="date" value={formStart} onChange={e => setFormStart(e.target.value)}
                    style={{ width: '100%', padding: '8px 11px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 5 }}>End Date</label>
                  <input type="date" value={formEnd} onChange={e => setFormEnd(e.target.value)}
                    style={{ width: '100%', padding: '8px 11px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, boxSizing: 'border-box' }} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 8 }}>
                  Tasks in Sprint <span style={{ fontWeight: 400 }}>({formTaskIds.length} selected)</span>
                </label>
                <div style={{ border: '1px solid var(--border)', borderRadius: 8, maxHeight: 300, overflowY: 'auto' }}>
                  {rootTasks.length === 0 && (
                    <p style={{ padding: '12px 14px', color: 'var(--muted)', fontSize: 13, margin: 0 }}>No tasks available.</p>
                  )}
                  {rootTasks.map(t => renderTaskRow(t, 0))}
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 4 }}>
                <button type="button" onClick={() => setShowModal(false)} className="btn-ghost" style={{ fontSize: 13, padding: '7px 16px' }}>Cancel</button>
                <button type="submit" style={{
                  padding: '7px 20px', borderRadius: 8, border: 'none',
                  background: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                }}>{editingSprint ? 'Save Changes' : 'Create Sprint'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}

const STATUS_COUNT_COLUMNS = [
  { status: 'backlog',     label: 'Backlog',     color: '#94a3b8' },
  { status: 'todo',        label: 'To Do',       color: '#3b82f6' },
  { status: 'in-progress', label: 'In Progress', color: '#f59e0b' },
  { status: 'in-review',   label: 'In Review',   color: '#8b5cf6' },
  { status: 'blocked',     label: 'Blocked',     color: '#dc2626' },
  { status: 'done',        label: 'Done',        color: '#16a34a' },
]

function StatusCounts({ tasks }) {
  const counts = tasks.reduce((acc, t) => {
    if (t.archived) return acc
    const s = t.status || 'todo'
    acc[s] = (acc[s] || 0) + 1
    return acc
  }, {})
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {STATUS_COUNT_COLUMNS.map(c => (
        <span key={c.status} style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '2px 9px', borderRadius: 20, fontSize: 11, fontWeight: 600,
          background: `${c.color}18`, color: c.color, border: `1px solid ${c.color}40`,
          whiteSpace: 'nowrap',
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: c.color, flexShrink: 0 }} />
          {c.label}
          <span style={{ fontWeight: 800 }}>{counts[c.status] || 0}</span>
        </span>
      ))}
    </div>
  )
}

function TaskSkeleton() {
  return (
    <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {[0, 1, 2, 3, 4].map(i => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: i % 2 === 0 ? 0 : 20 }}>
          <span className="skeleton" style={{ width: 18, height: 18, borderRadius: '50%', flexShrink: 0 }} />
          <span className="skeleton" style={{ width: `${45 + (i * 11) % 35}%`, height: 13 }} />
          <span className="skeleton" style={{ width: 50, height: 18, borderRadius: 10, marginLeft: 'auto' }} />
        </div>
      ))}
    </div>
  )
}

export default function TasksPage({ currentUser }) {
  const router = useRouter()
  const { slug, version } = router.query

  const [projectName, setProjectName] = useState('')
  const [taskAcl, setTaskAcl] = useState(null)
  const [taskPrefix, setTaskPrefix] = useState('')
  const [taskSeqStart, setTaskSeqStart] = useState(1)
  const [showIdSettings, setShowIdSettings] = useState(false)
  const [idDraft, setIdDraft] = useState({ prefix: '', start: '1' })
  const [savingId, setSavingId] = useState(false)
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [versions, setVersions] = useState([])
  const [viewMode, setViewMode] = useState('list')
  const [showArchived, setShowArchived] = useState(false)
  const [sprintKey, setSprintKey] = useState(0)
  const [sprintRefreshTrigger, setSprintRefreshTrigger] = useState(0)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [importFormat, setImportFormat] = useState('csv')
  const [importFile, setImportFile] = useState(null)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')
  const [importSuccess, setImportSuccess] = useState('')

  const apiBase = slug
    ? version
      ? `/api/projects/${slug}/versions/${version}/tasks`
      : `/api/projects/${slug}/tasks`
    : null

  const loadTasks = useCallback((opts = {}) => {
    if (!apiBase) return
    // Skeleton only on initial load. Background refreshes (status change, drag,
    // reorder) keep the board mounted to avoid a whole-page flicker.
    if (!opts.background) setLoading(true)
    fetch(apiBase)
      .then(r => r.ok ? r.json() : [])
      .then(data => { setTasks(data); setLoading(false); setSprintRefreshTrigger(n => n + 1) })
      .catch(() => setLoading(false))
  }, [apiBase])

  const refreshTasks = useCallback(() => loadTasks({ background: true }), [loadTasks])

  function openIdSettings() {
    setIdDraft({ prefix: taskPrefix || '', start: String(taskSeqStart || 1) })
    setShowIdSettings(true)
  }
  async function saveIdSettings() {
    if (!slug) return
    setSavingId(true)
    const prefix = (idDraft.prefix || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
    const start = Math.max(1, parseInt(idDraft.start, 10) || 1)
    const res = await apiFetch(`/api/projects/${slug}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskPrefix: prefix, taskSeqStart: start }),
    })
    setSavingId(false)
    if (res.ok) {
      setTaskPrefix(prefix)
      setTaskSeqStart(start)
      setShowIdSettings(false)
    }
  }

  useEffect(() => {
    if (!router.isReady || !slug) return
    apiFetch(`/api/projects/${slug}`)
      .then(r => r.ok ? r.json() : null)
      .then(p => {
        if (p) {
          setProjectName(p.name)
          setVersions(p.versions || [])
          setTaskAcl(p.taskAcl || null)
          setTaskPrefix(p.taskPrefix || '')
          setTaskSeqStart(p.taskSeqStart || 1)
        }
      })
  }, [router.isReady, slug])

  useEffect(() => {
    if (!router.isReady) return
    loadTasks()
  }, [router.isReady, loadTasks])

  async function handleExport(format) {
    setShowExportMenu(false)
    const params = new URLSearchParams({ format })
    if (version) params.set('version', version)
    const res = await apiFetch(`/api/projects/${slug}/export?${params}`)
    if (!res.ok) return
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = format === 'json' ? `${slug}-prd.json` : `${slug}-tasks${version ? `-v${version}` : ''}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  async function handleImport(e) {
    e.preventDefault()
    if (!importFile) return
    setImporting(true)
    setImportError('')
    setImportSuccess('')
    try {
      const content = await importFile.text()
      let body
      if (importFormat === 'csv') {
        body = { format: 'csv', content }
      } else {
        try { body = { format: 'json', data: JSON.parse(content) } }
        catch { setImportError('Invalid JSON file'); setImporting(false); return }
      }
      const params = new URLSearchParams()
      if (version) params.set('version', version)
      const res = await apiFetch(`/api/projects/${slug}/import?${params}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setImportError(err.error || 'Import failed')
      } else {
        const result = await res.json()
        setImportSuccess(`Imported ${result.created} task${result.created !== 1 ? 's' : ''} successfully`)
        setImportFile(null)
        loadTasks()
      }
    } finally {
      setImporting(false)
    }
  }

  const archivedTasks = tasks.filter(t => t.archived)

  async function restoreTask(id) {
    await apiFetch(`${apiBase}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: false, archivedAt: null }),
    })
    loadTasks()
  }

  async function permaDeleteTask(id) {
    if (!confirm('Permanently delete this card and its sub-tasks? This cannot be undone.')) return
    await apiFetch(`${apiBase}/${id}`, { method: 'DELETE' })
    loadTasks()
  }

  const contextLabel = version ? `v${version} Tasks` : 'Project Tasks'

  if (!router.isReady) {
    return (
      <><Nav />
        <main className="page page--full">
          <div className="page-header">
            <span className="skeleton" style={{ width: 240, height: 12, marginBottom: 10 }} />
            <span className="skeleton" style={{ width: 180, height: 26 }} />
          </div>
          <div style={{ display: 'flex', gap: 4, marginTop: 20 }}>
            {[0, 1, 2].map(i => <span key={i} className="skeleton" style={{ width: 80, height: 34, borderRadius: '6px 6px 0 0' }} />)}
          </div>
          <div className="section-card" style={{ marginTop: 16 }}>
            <div className="section-card-header"><span className="skeleton" style={{ width: 100, height: 13 }} /></div>
            <TaskSkeleton />
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      <Nav />
      <main className="page page--full">
        <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 4 }}>
              <Link href="/">Projects</Link> / <Link href={`/projects/${slug}`}>{projectName || slug}</Link> / {contextLabel}
            </div>
            <h1>{contextLabel}</h1>
            {version && <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>Tasks scoped to version {version}</p>}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setShowExportMenu(p => !p)}
                className="btn-ghost"
                style={{ fontSize: 13, padding: '6px 14px' }}
              >
                Export ▾
              </button>
              {showExportMenu && (
                <div
                  style={{
                    position: 'absolute', top: '100%', right: 0, marginTop: 4,
                    background: '#fff', border: '1px solid var(--border)', borderRadius: 8,
                    boxShadow: '0 4px 16px rgba(0,0,0,.1)', zIndex: 200, minWidth: 160, overflow: 'hidden',
                  }}
                  onMouseLeave={() => setShowExportMenu(false)}
                >
                  <button
                    onClick={() => handleExport('json')}
                    style={{ display: 'block', width: '100%', padding: '9px 16px', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text)' }}
                  >
                    Download JSON
                  </button>
                  <button
                    onClick={() => handleExport('csv')}
                    style={{ display: 'block', width: '100%', padding: '9px 16px', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text)' }}
                  >
                    Download CSV
                  </button>
                </div>
              )}
            </div>
            <button onClick={() => { setShowImport(true); setImportError(''); setImportSuccess(''); setImportFile(null) }} className="btn-ghost" style={{ fontSize: 13, padding: '6px 14px' }}>
              Import
            </button>
            <Link href={`/projects/${slug}/dashboard`} className="btn-ghost" style={{ fontSize: 13, padding: '6px 14px', textDecoration: 'none' }}>
              Dashboard
            </Link>
            <Link href={`/projects/${slug}`} className="btn-ghost" style={{ fontSize: 13, padding: '6px 14px', textDecoration: 'none' }}>
              ← Back to Project
            </Link>
          </div>
        </div>

        <div className="task-context-tabs">
          <Link
            href={`/projects/${slug}/tasks`}
            className={`task-context-tab ${!version ? 'active' : ''}`}
          >
            Project Tasks
          </Link>
          {versions.map(v => (
            <Link
              key={v.version}
              href={`/projects/${slug}/tasks?version=${v.version}`}
              className={`task-context-tab ${version === v.version ? 'active' : ''}`}
            >
              v{v.version}
            </Link>
          ))}
        </div>

        {slug && (
          <SprintsSection
            key={sprintKey}
            slug={slug}
            tasks={tasks}
            onSprintChange={() => setSprintKey(k => k + 1)}
            refreshTrigger={sprintRefreshTrigger}
          />
        )}

        <div className="section-card" style={{ marginTop: 0 }}>
          <div className="section-card-header">
            <span>{contextLabel}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {!loading && <span className="badge">{tasks.length}</span>}
              {!loading && <StatusCounts tasks={tasks} />}
              {currentUser?.isAdmin && slug && (
                <button className="btn-ghost" style={{ whiteSpace: 'nowrap', fontSize: 12 }} onClick={openIdSettings} title="Set task ID prefix & start number">
                  ⚙ Task IDs
                </button>
              )}
              <div className="kanban-view-toggle">
                <button
                  className={`kanban-view-btn${viewMode === 'list' ? ' active' : ''}`}
                  onClick={() => setViewMode('list')}
                  title="List view"
                >List</button>
                <button
                  className={`kanban-view-btn${viewMode === 'kanban' ? ' active' : ''}`}
                  onClick={() => setViewMode('kanban')}
                  title="Kanban board"
                >Kanban</button>
                <button
                  className={`kanban-view-btn${viewMode === 'calendar' ? ' active' : ''}`}
                  onClick={() => setViewMode('calendar')}
                  title="Calendar view"
                >Calendar</button>
              </div>
            </div>
          </div>
          {loading ? <TaskSkeleton /> : viewMode === 'kanban' ? (
            <KanbanBoard key={apiBase} tasks={tasks} apiBase={apiBase} slug={slug} onRefresh={refreshTasks} currentUser={currentUser} taskAcl={taskAcl} onAclChange={setTaskAcl} taskPrefix={taskPrefix} onPrefixChange={setTaskPrefix} taskSeqStart={taskSeqStart} onSeqStartChange={setTaskSeqStart} />
          ) : viewMode === 'calendar' ? (
            <CalendarView tasks={tasks} apiBase={apiBase} onRefresh={refreshTasks} currentUser={currentUser} />
          ) : (
            <TaskTree tasks={tasks} apiBase={apiBase} onRefresh={refreshTasks} currentUser={currentUser} taskAcl={taskAcl} taskPrefix={taskPrefix} />
          )}
        </div>

        {archivedTasks.length > 0 && (
          <div className="section-card" style={{ marginTop: 12 }}>
            <div className="section-card-header">
              <button
                onClick={() => setShowArchived(v => !v)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6, padding: 0 }}
              >
                {showArchived ? '▾' : '▸'} Archived ({archivedTasks.length})
              </button>
            </div>
            {showArchived && (
              <div className="archived-list">
                {archivedTasks.map(t => (
                  <div key={t.id} className="archived-row">
                    {t.number && <span className="task-number" style={{ fontSize: 11 }}>{t.number}</span>}
                    <span className="archived-title">{t.title}</span>
                    <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => restoreTask(t.id)}>Restore</button>
                    {currentUser?.isAdmin && (
                      <button className="btn-ghost" style={{ fontSize: 12, color: '#dc2626' }} onClick={() => permaDeleteTask(t.id)}>Delete</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {showIdSettings && (
          <div className="kanban-modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowIdSettings(false) }}>
            <div className="kanban-modal" style={{ maxWidth: 420 }}>
              <div className="kanban-modal-header">
                <span>Task IDs</span>
                <button className="kanban-modal-close" onClick={() => setShowIdSettings(false)}>✕</button>
              </div>
              <div className="task-form">
                <div className="task-assignees-label" style={{ marginBottom: 6 }}>Task ID prefix</div>
                <input
                  className="form-input"
                  placeholder="e.g. ENG, MED, CON, WAR"
                  value={idDraft.prefix}
                  maxLength={8}
                  onChange={e => setIdDraft(d => ({ ...d, prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') }))}
                  style={{ textTransform: 'uppercase' }}
                />
                <div className="task-assignees-label" style={{ margin: '12px 0 6px' }}>Start number</div>
                <input
                  className="form-input"
                  type="number"
                  min={1}
                  placeholder="1"
                  value={idDraft.start}
                  onChange={e => setIdDraft(d => ({ ...d, start: e.target.value.replace(/[^0-9]/g, '') }))}
                />
                <p style={{ fontSize: 11, color: 'var(--muted)', margin: '8px 0 0' }}>
                  Tasks show <strong>{(idDraft.prefix || 'ENG')}-{idDraft.start || '1'}</strong>. New ids count up from the largest existing one, never below the start. Existing ids never change. Leave prefix blank to hide ids.
                </p>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                  <button className="btn-ghost" onClick={() => setShowIdSettings(false)}>Cancel</button>
                  <button className="btn-primary" onClick={saveIdSettings} disabled={savingId}>{savingId ? 'Saving…' : 'Save'}</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {showImport && (
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
            onClick={e => { if (e.target === e.currentTarget) setShowImport(false) }}
          >
            <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,.18)' }}>
              <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h2 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>Import Tasks</h2>
                <button onClick={() => setShowImport(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#94a3b8', lineHeight: 1 }}>×</button>
              </div>
              <form onSubmit={handleImport} style={{ padding: '20px 22px' }}>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 8 }}>Format</label>
                  <div style={{ display: 'flex', gap: 16 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                      <input type="radio" value="csv" checked={importFormat === 'csv'} onChange={() => setImportFormat('csv')} />
                      CSV
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                      <input type="radio" value="json" checked={importFormat === 'json'} onChange={() => setImportFormat('json')} />
                      JSON
                    </label>
                  </div>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 8 }}>File</label>
                  <input
                    type="file"
                    accept={importFormat === 'csv' ? '.csv,text/csv' : '.json,application/json'}
                    onChange={e => { setImportFile(e.target.files?.[0] || null); setImportError(''); setImportSuccess('') }}
                    style={{ fontSize: 13 }}
                  />
                </div>
                {importFormat === 'csv' && (
                  <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.5 }}>
                    Required header: <code>title</code>. Optional: <code>status</code>, <code>priority</code>, <code>assignees</code> (semicolon-separated), <code>startDate</code>, <code>dueDate</code>, <code>description</code>
                  </p>
                )}
                {importFormat === 'json' && (
                  <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.5 }}>
                    Accepts the JSON export format or a plain array of task objects.
                  </p>
                )}
                {importError && <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{importError}</p>}
                {importSuccess && <p style={{ color: '#15803d', fontSize: 13, marginBottom: 12 }}>{importSuccess}</p>}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button type="button" onClick={() => setShowImport(false)} className="btn-ghost" style={{ fontSize: 13, padding: '7px 16px' }}>Cancel</button>
                  <button
                    type="submit"
                    disabled={!importFile || importing}
                    style={{ fontSize: 13, padding: '7px 16px', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', fontWeight: 600, cursor: importFile && !importing ? 'pointer' : 'not-allowed', opacity: importFile && !importing ? 1 : 0.6 }}
                  >
                    {importing ? 'Importing…' : 'Import'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </>
  )
}
