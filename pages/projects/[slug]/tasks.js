import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import Nav from '../../../components/Nav'
import SubmitButton from '../../../components/SubmitButton'
import { apiFetch } from '../../../lib/api-fetch'
import { enqueue, newId, onSync } from '../../../lib/submit-queue'
import { useOptimistic } from '../../../lib/optimistic'
import { reshapesTree } from '../../../lib/task-reconcile'
import TaskTree from '../../../components/TaskTree'
import KanbanBoard from '../../../components/KanbanBoard'
import CalendarView from '../../../components/CalendarView'

// ─── Active Sprint ────────────────────────────────────────────────────────────

function SprintProgressBar({ done, total }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const color = pct === 100 ? 'var(--tint-green-fg)' : pct >= 60 ? 'var(--tint-blue-fg)' : pct >= 30 ? 'var(--tint-amber-fg)' : 'var(--accent)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
      <div style={{ flex: 1, height: 8, background: 'var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 8, transition: 'width .4s ease', minWidth: pct > 0 ? 6 : 0 }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color, whiteSpace: 'nowrap' }}>{done}/{total}</span>
    </div>
  )
}

function SprintTaskChip({ task, sub }) {
  const isDone = task.status === 'done'
  const isInProgress = task.status === 'in-progress'
  const dotColor = isDone ? 'var(--tint-green-fg)' : isInProgress ? 'var(--tint-blue-fg)' : 'var(--muted)'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: sub ? '2px 8px' : '3px 10px',
      borderRadius: 20,
      fontSize: sub ? 11 : 12,
      fontWeight: 500,
      background: isDone ? 'var(--tint-green-bg)' : isInProgress ? 'var(--tint-blue-bg)' : 'var(--surface-2)',
      color: isDone ? 'var(--tint-green-fg)' : isInProgress ? 'var(--tint-blue-fg)' : 'var(--muted)',
      border: `1px solid ${isDone ? 'color-mix(in srgb, var(--tint-green-fg) 45%, transparent)' : isInProgress ? 'color-mix(in srgb, var(--tint-blue-fg) 45%, transparent)' : 'var(--border)'}`,
      textDecoration: isDone ? 'line-through' : 'none',
      whiteSpace: 'nowrap',
      opacity: sub ? 0.9 : 1,
    }}>
      <span style={{ width: sub ? 5 : 7, height: sub ? 5 : 7, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
      {task.number && <span style={{ fontSize: sub ? 9 : 10, color: 'var(--muted)' }}>#{task.number}</span>}
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
            i > 0 ? <span key={`sep-${t.id}`} style={{ color: 'var(--border)', fontSize: 12, userSelect: 'none' }}>›</span> : null,
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
  const [serverSprints, setServerSprints] = useState([])
  const [loadingS, setLoadingS]           = useState(true)
  const [showModal, setShowModal]         = useState(false)
  const [editingSprint, setEditingSprint] = useState(null)
  const [showCompleted, setShowCompleted] = useState(false)

  const [formName, setFormName]       = useState('')
  const [formStart, setFormStart]     = useState('')
  const [formEnd, setFormEnd]         = useState('')
  const [formTaskIds, setFormTaskIds] = useState([])
  const [formStatus, setFormStatus]   = useState('active')

  const sprints = useOptimistic(serverSprints, { entity: 'sprint', scope: `/api/projects/${slug}/sprint` })

  const loadSprints = useCallback(() => {
    if (!slug) return Promise.resolve()
    return apiFetch(`/api/projects/${slug}/sprint`)
      .then(r => r.ok ? r.json() : [])
      .then(data => { setServerSprints(Array.isArray(data) ? data : []); setLoadingS(false) })
      .catch(() => setLoadingS(false))
  }, [slug])

  useEffect(() => { loadSprints() }, [loadSprints])
  useEffect(() => onSync(item => {
    if (item.optimistic?.entity === 'sprint') return loadSprints()
  }), [loadSprints])
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

  const sprintScope = `/api/projects/${slug}/sprint`

  function handleSave(e) {
    e.preventDefault()
    const body = { name: formName, startDate: formStart || null, endDate: formEnd || null, taskIds: formTaskIds, status: formStatus }
    if (editingSprint) {
      enqueue({
        url: `${sprintScope}?id=${editingSprint.id}`,
        method: 'PUT',
        body,
        label: `Update sprint “${formName}”`,
        optimistic: { entity: 'sprint', op: 'update', scope: sprintScope, id: editingSprint.id, patch: body },
      })
    } else {
      const id = newId('sprint')
      enqueue({
        url: sprintScope,
        method: 'POST',
        body: { ...body, id },
        label: `Create sprint “${formName}”`,
        // `tasks` is what the hydrated GET returns; seed it so the card renders.
        optimistic: { entity: 'sprint', op: 'create', scope: sprintScope, data: { ...body, id, tasks: [], createdAt: new Date().toISOString() } },
      })
    }
    setShowModal(false)
    onSprintChange?.()
  }

  // The sprint PUT replaces the whole record, so every status flip has to resend the
  // fields it is not changing.
  function setSprintStatus(sprint, status) {
    const body = { name: sprint.name, startDate: sprint.startDate, endDate: sprint.endDate, taskIds: sprint.taskIds, status }
    enqueue({
      url: `${sprintScope}?id=${sprint.id}`,
      method: 'PUT',
      body,
      label: `${status === 'completed' ? 'Complete' : 'Start'} sprint “${sprint.name}”`,
      optimistic: { entity: 'sprint', op: 'update', scope: sprintScope, id: sprint.id, patch: { status } },
    })
    onSprintChange?.()
  }

  function completeSprint(sprint) {
    if (!confirm(`Mark "${sprint.name}" as completed?`)) return
    setSprintStatus(sprint, 'completed')
  }

  function startSprint(sprint) {
    setSprintStatus(sprint, 'active')
  }

  function handleDelete(sprint) {
    if (!confirm(`Delete "${sprint.name}"? This cannot be undone.`)) return
    enqueue({
      url: `${sprintScope}?id=${sprint.id}`,
      method: 'DELETE',
      label: `Delete sprint “${sprint.name}”`,
      optimistic: { entity: 'sprint', op: 'delete', scope: sprintScope, id: sprint.id },
    })
    onSprintChange?.()
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
    const bgColors = [
      'var(--surface)',
      'color-mix(in srgb, var(--surface) 97%, var(--text))',
      'color-mix(in srgb, var(--surface) 94%, var(--text))',
      'color-mix(in srgb, var(--surface) 91%, var(--text))',
    ]
    const bgSelected = [
      'color-mix(in srgb, var(--surface) 90%, var(--accent))',
      'color-mix(in srgb, var(--surface) 87%, var(--accent))',
      'color-mix(in srgb, var(--surface) 84%, var(--accent))',
      'color-mix(in srgb, var(--surface) 81%, var(--accent))',
    ]
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
          {d > 0 && <span style={{ fontSize: 9, color: 'var(--muted)', flexShrink: 0 }}>↳</span>}
          <input type="checkbox" checked={formTaskIds.includes(t.id)} onChange={() => toggleTask(t.id)} style={{ flexShrink: 0 }} />
          {t.number && <span style={{ fontSize: d === 0 ? 11 : 10, color: 'var(--muted)', flexShrink: 0 }}>#{t.number}</span>}
          <span style={{ flex: 1, fontWeight: d === 0 ? 600 : 400, color: 'var(--text)', textDecoration: t.status === 'done' ? 'line-through' : 'none' }}>{t.title}</span>
          {totalDesc > 0 && <span style={{ fontSize: 10, color: 'var(--muted)', flexShrink: 0 }}>{selDesc}/{totalDesc}</span>}
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 10, flexShrink: 0,
            background: t.status === 'done' ? 'var(--tint-green-bg)' : t.status === 'in-progress' ? 'var(--tint-blue-bg)' : 'var(--tint-slate-bg)',
            color: t.status === 'done' ? 'var(--tint-green-fg)' : t.status === 'in-progress' ? 'var(--tint-blue-fg)' : 'var(--muted)',
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
            border: '1px solid color-mix(in srgb, var(--tint-indigo-fg) 45%, transparent)', borderRadius: 12,
            background: 'linear-gradient(135deg, var(--tint-indigo-bg) 0%, var(--tint-green-bg) 100%)',
            padding: '16px 20px', marginBottom: 10,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: allItems.length > 0 ? 12 : 0 }}>
              <span style={{ fontSize: 16 }}>⚡</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--tint-indigo-fg)' }}>Active Sprint:</span>
              <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--tint-indigo-fg)' }}>{sprint.name}</span>
              {(sprint.startDate || sprint.endDate) && (
                <span style={{ fontSize: 12, color: 'var(--tint-gray-fg)' }}>
                  {formatSprintDate(sprint.startDate)}{sprint.startDate && sprint.endDate ? ' – ' : ''}{formatSprintDate(sprint.endDate)}
                </span>
              )}
              {remaining !== null && (
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                  background: isOverdue ? 'var(--tint-red-bg)' : remaining <= 2 ? 'var(--tint-amber-bg)' : 'var(--tint-green-bg)',
                  color: isOverdue ? 'var(--tint-red-fg)' : remaining <= 2 ? 'var(--tint-amber-fg)' : 'var(--tint-green-fg)',
                  border: `1px solid ${isOverdue ? 'var(--tint-red-border)' : remaining <= 2 ? 'color-mix(in srgb, var(--tint-amber-fg) 45%, transparent)' : 'color-mix(in srgb, var(--tint-green-fg) 45%, transparent)'}`,
                }}>
                  {isOverdue ? `${Math.abs(remaining)}d overdue` : remaining === 0 ? 'Ends today' : `${remaining}d left`}
                </span>
              )}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button onClick={() => openEdit(sprint)} style={{
                  padding: '5px 12px', borderRadius: 7, border: '1px solid color-mix(in srgb, var(--tint-indigo-fg) 45%, transparent)',
                  background: 'var(--surface)', color: 'var(--tint-indigo-fg)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}>Manage</button>
                <button onClick={() => completeSprint(sprint)} style={{
                  padding: '5px 12px', borderRadius: 7, border: '1px solid color-mix(in srgb, var(--tint-green-fg) 45%, transparent)',
                  background: 'var(--surface)', color: 'var(--tint-green-fg)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}>Complete</button>
                <button onClick={() => handleDelete(sprint)} style={{
                  padding: '5px 12px', borderRadius: 7, border: '1px solid var(--tint-red-border)',
                  background: 'var(--surface)', color: 'var(--tint-red-fg)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
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
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
                No tasks in this sprint yet — click <strong>Manage</strong> to add some.
              </p>
            )}
          </div>
        )
      })}

      {/* Planned sprints */}
      {plannedSprints.length > 0 && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface-2)', padding: '12px 16px', marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.05em', marginBottom: 8 }}>PLANNED</div>
          {plannedSprints.map((sprint, i) => {
            const sprintIdSet = new Set(sprint.taskIds || [])
            const allItems    = sprint.tasks || []
            return (
              <div key={sprint.id} style={{
                padding: '8px 0', borderBottom: i < plannedSprints.length - 1 ? '1px solid var(--border)' : 'none',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14 }}>📋</span>
                  <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>{sprint.name}</span>
                  {(sprint.startDate || sprint.endDate) && (
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {formatSprintDate(sprint.startDate)}{sprint.startDate && sprint.endDate ? ' – ' : ''}{formatSprintDate(sprint.endDate)}
                    </span>
                  )}
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{allItems.length} tasks</span>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    <button onClick={() => startSprint(sprint)} style={{
                      padding: '4px 10px', borderRadius: 6, border: '1px solid var(--tint-indigo-fg)',
                      background: 'var(--tint-indigo-fg)', color: 'var(--surface)', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    }}>▶ Start</button>
                    <button onClick={() => openEdit(sprint)} style={{
                      padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)',
                      background: 'var(--surface)', color: 'var(--muted)', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    }}>Edit</button>
                    <button onClick={() => handleDelete(sprint)} style={{
                      padding: '4px 10px', borderRadius: 6, border: '1px solid var(--tint-red-border)',
                      background: 'var(--surface)', color: 'var(--tint-red-fg)', fontSize: 11, fontWeight: 600, cursor: 'pointer',
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
            color: 'var(--muted)', fontWeight: 600, padding: '4px 0', display: 'flex', alignItems: 'center', gap: 6,
          }}>
            {showCompleted ? '▾' : '▸'} Completed sprints ({completedSprints.length})
          </button>
          {showCompleted && (
            <div style={{ border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface-2)', padding: '10px 14px', marginTop: 6 }}>
              {completedSprints.map((sprint, i) => {
                const sprintIdSet = new Set(sprint.taskIds || [])
                const allItems    = sprint.tasks || []
                const doneTasks   = allItems.filter(t => t.status === 'done').length
                return (
                  <div key={sprint.id} style={{
                    padding: '7px 0', borderBottom: i < completedSprints.length - 1 ? '1px solid var(--border)' : 'none',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13 }}>✓</span>
                      <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>{sprint.name}</span>
                      {(sprint.startDate || sprint.endDate) && (
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                          {formatSprintDate(sprint.startDate)}{sprint.startDate && sprint.endDate ? ' – ' : ''}{formatSprintDate(sprint.endDate)}
                        </span>
                      )}
                      <span style={{ fontSize: 12, color: 'var(--tint-green-fg)', fontWeight: 600 }}>{doneTasks}/{allItems.length} done</span>
                      <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                        <button onClick={() => handleDelete(sprint)} style={{
                          padding: '3px 8px', borderRadius: 6, border: '1px solid var(--tint-red-border)',
                          background: 'var(--surface)', color: 'var(--tint-red-fg)', fontSize: 11, fontWeight: 600, cursor: 'pointer',
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
          border: '1px solid color-mix(in srgb, var(--tint-indigo-fg) 45%, transparent)', borderRadius: 12,
          background: 'linear-gradient(135deg, var(--tint-indigo-bg) 0%, var(--tint-green-bg) 100%)',
          padding: '16px 20px', marginBottom: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18 }}>⚡</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--muted)' }}>No sprints yet</span>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>— Create a sprint to track focused work</span>
          </div>
          <button onClick={openNew} style={{
            padding: '6px 14px', borderRadius: 8, border: '1px solid var(--tint-indigo-fg)',
            background: 'var(--tint-indigo-fg)', color: 'var(--surface)', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
          }}>+ New Sprint</button>
        </div>
      )}

      {/* New sprint button (when sprints exist) */}
      {sprints.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
          <button onClick={openNew} style={{
            padding: '5px 14px', borderRadius: 8, border: '1px solid var(--tint-indigo-fg)',
            background: 'var(--surface)', color: 'var(--tint-indigo-fg)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
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
            background: 'var(--surface)', borderRadius: 14, width: '100%', maxWidth: 520,
            boxShadow: '0 20px 60px rgba(0,0,0,.18)', maxHeight: '90vh', display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>{editingSprint ? 'Edit Sprint' : 'New Sprint'}</h2>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--muted)', lineHeight: 1 }}>×</button>
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
                <SubmitButton type="submit" onClick={handleSave} className="" style={{
                  padding: '7px 20px', borderRadius: 8, border: 'none',
                  background: 'var(--tint-indigo-fg)', color: 'var(--surface)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}>{editingSprint ? 'Save Changes' : 'Create Sprint'}</SubmitButton>
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
      {/* The hue is data; the wash, border and dark-mode ink lift live in CSS,
          which is the only place that can tell which theme is on. */}
      {STATUS_COUNT_COLUMNS.map(c => (
        <span key={c.status} className="status-count-chip" style={{ '--status-color': c.color }}>
          <span className="status-count-dot" />
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
  const { slug, version, task: focusTaskId } = router.query

  const [projectName, setProjectName] = useState('')
  const [access, setAccess] = useState(null)
  const [taskAcl, setTaskAcl] = useState(null)
  const [taskPrefix, setTaskPrefix] = useState('')
  const [taskSeqStart, setTaskSeqStart] = useState(1)
  const [showIdSettings, setShowIdSettings] = useState(false)
  const [idDraft, setIdDraft] = useState({ prefix: '', start: '1' })
  const [serverTasks, setServerTasks] = useState([])
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

  // Single choke point for the board, tree and calendar: every queued task mutation
  // for this apiBase is replayed on top of whatever the server last returned. A
  // refetch therefore cannot make a just-created card blink out of existence while
  // its POST is still in flight.
  const tasks = useOptimistic(serverTasks, { entity: 'task', scope: apiBase, cascade: true })

  // Refetches fire from several places at once (initial load, every queue sync, sprint
  // changes). Responses can land out of order, so an older one must never overwrite a
  // newer list — that is how a just-created task disappears again after saving.
  const loadSeq = useRef(0)

  // Latest server data, readable synchronously. The sync listener has to decide whether
  // a write reshaped the tree BEFORE it picks reconcile-or-refetch, which it cannot do
  // from inside a setState updater.
  const serverTasksRef = useRef([])
  useEffect(() => { serverTasksRef.current = serverTasks }, [serverTasks])

  // Returns the in-flight promise: onSync awaits it, so a synced write stays on the
  // optimistic overlay until the refreshed server data is actually in state.
  const loadTasks = useCallback((opts = {}) => {
    if (!apiBase) return Promise.resolve()
    // Skeleton only on initial load. Background refreshes (status change, drag,
    // reorder) keep the board mounted to avoid a whole-page flicker.
    if (!opts.background) setLoading(true)
    const seq = ++loadSeq.current
    return apiFetch(apiBase)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (seq !== loadSeq.current) return // a newer fetch already answered
        // A failed GET means "unknown", not "empty" — keep what we have rather than
        // blanking the list.
        if (Array.isArray(data)) { setServerTasks(data); setSprintRefreshTrigger(n => n + 1) }
        setLoading(false)
      })
      .catch(() => { if (seq === loadSeq.current) setLoading(false) })
  }, [apiBase])

  const refreshTasks = useCallback(() => loadTasks({ background: true }), [loadTasks])

  // Fold in server-assigned fields (seq, number, order) once a queued write lands.
  // Moves (drag, ↑/↓) carry no optimistic descriptor — the server reindexes siblings and
  // renumbers, which is not replayable client-side — so match on the url too, otherwise a
  // move would only appear after a reload.
  //
  // Reconciling from the write's OWN response wherever it is sufficient, rather than
  // re-GETting the list. The list is ~500 KB at this project's size and it was coming
  // back down the wire on every status flip, drag and comment — the payload volume that
  // blew Fast Origin Transfer once already. The response already carries the answer:
  //
  //   PATCH  -> the full renumbered array (computeNumbers server-side) — a drop-in list
  //   POST   -> the created task, numbered; appending renumbers nothing
  //   PUT    -> the updated task, as long as the edit cannot reshape the tree
  //
  // Deletes cascade to children and renumber the siblings left behind, and a structural
  // PUT reparents or renumbers — neither is reconstructable from the response, so those
  // still refetch.
  useEffect(() => onSync((item, response) => {
    if (!apiBase) return
    const scoped = item.optimistic
      ? item.optimistic.entity === 'task' && item.optimistic.scope === apiBase
      : typeof item.url === 'string' && item.url.startsWith(apiBase)
    if (!scoped) return

    const method = String(item.method || '').toUpperCase()

    // Any GET issued before this write must not land on top of what we just applied.
    // loadTasks() already discards responses older than loadSeq; bump it so a reconcile
    // invalidates in-flight fetches the same way a refetch would.
    const settle = next => {
      loadSeq.current++
      setServerTasks(next)
      setSprintRefreshTrigger(n => n + 1)
      setLoading(false)
    }

    if (method === 'PATCH' && Array.isArray(response)) {
      settle(response)
      return
    }
    if (method === 'POST' && response && response.id) {
      settle(prev => (prev.some(t => t.id === response.id) ? prev : [...prev, response]))
      return
    }
    if (method === 'PUT' && response && response.id) {
      const before = serverTasksRef.current.find(t => t.id === response.id)
      if (!reshapesTree(item.body, before)) {
        settle(prev => prev.map(t => (t.id === response.id ? { ...t, ...response } : t)))
        return
      }
    }

    // Returned so the queue holds the item until this refetch has landed.
    return refreshTasks()
  }), [apiBase, refreshTasks])

  function openIdSettings() {
    setIdDraft({ prefix: taskPrefix || '', start: String(taskSeqStart || 1) })
    setShowIdSettings(true)
  }
  function saveIdSettings() {
    if (!slug) return
    const prefix = (idDraft.prefix || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
    const start = Math.max(1, parseInt(idDraft.start, 10) || 1)
    enqueue({
      url: `/api/projects/${slug}`,
      method: 'PUT',
      body: { taskPrefix: prefix, taskSeqStart: start },
      label: 'Save task ID settings',
    })
    setTaskPrefix(prefix)
    setTaskSeqStart(start)
    setShowIdSettings(false)
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

  // This project's effective role policy (per-project overrides fold in here).
  useEffect(() => {
    if (!router.isReady || !slug) return
    apiFetch(`/api/projects/${slug}/access`)
      .then(r => r.ok ? r.json() : null)
      .then(a => setAccess(a))
      .catch(() => {})
  }, [router.isReady, slug])

  // The session user carries global-default perms; overlay this project's policy so
  // the board/list only offer what the server will accept here. Superadmin is
  // unaffected (hasPerm short-circuits on role). Admins are capped by the project's
  // admin policy; viewers use the project's user policy + status blocklist.
  const scopedUser = useMemo(() => {
    if (!currentUser || !access) return currentUser
    if (currentUser.role === 'superadmin' || (currentUser.isAdmin && !currentUser.role)) return currentUser
    const u = { ...currentUser }
    // `effective` is what the server computed for THIS caller in THIS project
    // (personal + group grant, capped by the project policy).
    const effective = Array.isArray(access.effective) ? access.effective : null
    if (currentUser.role === 'admin') {
      const personal = Array.isArray(currentUser.permissions) ? currentUser.permissions : []
      u.permissions = effective || personal.filter(p => (access.admin || []).includes(p))
    } else {
      u.viewerPerms = effective || access.user || []
    }
    u.restrictedStatuses = access.userRestrictedStatuses || []
    return u
  }, [currentUser, access])

  useEffect(() => {
    if (!router.isReady) return
    loadTasks()
  }, [router.isReady, loadTasks])

  // A shared ?task= link points at a row in the tree, which only the list view renders.
  useEffect(() => { if (focusTaskId) setViewMode('list') }, [focusTaskId])

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

  function restoreTask(id) {
    const patch = { archived: false, archivedAt: null }
    enqueue({
      url: `${apiBase}/${id}`,
      method: 'PUT',
      body: patch,
      label: 'Restore card',
      optimistic: { entity: 'task', op: 'update', scope: apiBase, id, patch },
    })
  }

  function permaDeleteTask(id) {
    if (!confirm('Permanently delete this card and its sub-tasks? This cannot be undone.')) return
    enqueue({
      url: `${apiBase}/${id}`,
      method: 'DELETE',
      label: 'Delete card',
      optimistic: { entity: 'task', op: 'delete', scope: apiBase, id },
    })
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
            <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 10 }}>
              <h1>{contextLabel}</h1>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                — <Link href="/">Projects</Link> / <Link href={`/projects/${slug}`}>{projectName || slug}</Link> / {contextLabel}
              </div>
            </div>
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
                    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
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
            <KanbanBoard key={apiBase} tasks={tasks} apiBase={apiBase} slug={slug} currentUser={scopedUser} taskAcl={taskAcl} onAclChange={setTaskAcl} taskPrefix={taskPrefix} onPrefixChange={setTaskPrefix} taskSeqStart={taskSeqStart} onSeqStartChange={setTaskSeqStart} focusTaskId={focusTaskId} />
          ) : viewMode === 'calendar' ? (
            <CalendarView tasks={tasks} apiBase={apiBase} slug={slug} currentUser={scopedUser} />
          ) : (
            <TaskTree tasks={tasks} apiBase={apiBase} slug={slug} onRefresh={refreshTasks} currentUser={scopedUser} taskAcl={taskAcl} taskPrefix={taskPrefix} focusTaskId={focusTaskId} />
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
                      <button className="btn-ghost" style={{ fontSize: 12, color: 'var(--tint-red-fg)' }} onClick={() => permaDeleteTask(t.id)}>Delete</button>
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
                  <SubmitButton className="btn-primary" onClick={saveIdSettings}>Save</SubmitButton>
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
            <div style={{ background: 'var(--surface)', borderRadius: 14, width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,.18)' }}>
              <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h2 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>Import Tasks</h2>
                <button onClick={() => setShowImport(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--muted)', lineHeight: 1 }}>×</button>
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
                {importError && <p style={{ color: 'var(--tint-red-fg)', fontSize: 13, marginBottom: 12 }}>{importError}</p>}
                {importSuccess && <p style={{ color: 'var(--tint-green-fg)', fontSize: 13, marginBottom: 12 }}>{importSuccess}</p>}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button type="button" onClick={() => setShowImport(false)} className="btn-ghost" style={{ fontSize: 13, padding: '7px 16px' }}>Cancel</button>
                  <button
                    type="submit"
                    disabled={!importFile || importing}
                    style={{ fontSize: 13, padding: '7px 16px', borderRadius: 8, border: 'none', background: 'var(--tint-indigo-fg)', color: 'var(--surface)', fontWeight: 600, cursor: importFile && !importing ? 'pointer' : 'not-allowed', opacity: importFile && !importing ? 1 : 0.6 }}
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
