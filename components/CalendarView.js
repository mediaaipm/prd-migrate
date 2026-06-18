import { useState } from 'react'
import { apiFetch } from '../lib/api-fetch'

const PRIORITY_COLOR = { low: '#64748b', medium: '#f59e0b', high: '#dc2626' }
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

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

export default function CalendarView({ tasks, apiBase, onRefresh }) {
  const today = new Date()
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1))
  const [dragId, setDragId] = useState(null)
  const [dragOverDay, setDragOverDay] = useState(null)

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

  const todayKey = ymd(today)

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
            >
              <div className="cal-cell-date">{date.getDate()}</div>
              <div className="cal-cell-items">
                {items.map(t => (
                  <div
                    key={t.id}
                    className="cal-task"
                    draggable
                    onDragStart={() => setDragId(t.id)}
                    onDragEnd={() => { setDragId(null); setDragOverDay(null) }}
                    title={t.title}
                    style={{ borderLeftColor: PRIORITY_COLOR[t.priority] || '#64748b' }}
                  >
                    {t.number && <span className="cal-task-num">#{t.number}</span>}
                    <span className={t.status === 'done' ? 'cal-task-done' : ''}>{t.title}</span>
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
    </div>
  )
}
