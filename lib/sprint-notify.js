const { addNotifications } = require('./notification-store')

// In-app notifications for sprint lifecycle events. Batched per recipient — a
// notification list is one redis value, so each person gets one write however many
// entries they are owed. Never throws: a failed notification must not fail the sprint
// transition that triggered it.

function namesOf(task) {
  const list = Array.isArray(task?.assignees) ? task.assignees : (task?.assignee ? [task.assignee] : [])
  return list.map(a => (typeof a === 'object' ? a?.name : a)).filter(Boolean)
}

function fmt(iso) {
  if (!iso) return ''
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

// events: what applyCadence / the sprint route produced —
//   { type: 'started', sprint, idx }
//   { type: 'completed', completed, next, carried, sprintTasks, idx }
async function notifySprintEvents(slug, events, actorName) {
  try {
    const link = `/projects/${slug}/sprints`
    const batch = new Map()
    const queue = (name, entry) => {
      if (!name || name === actorName) return
      const cur = batch.get(name)
      if (cur) { if (!cur.some(e => e.text === entry.text)) cur.push(entry) } else batch.set(name, [entry])
    }

    for (const ev of events || []) {
      if (ev.type === 'started' && ev.sprint) {
        const s = ev.sprint
        const text = `${s.name} started${s.endDate ? ` — ends ${fmt(s.endDate)}` : ''}`
        for (const id of s.taskIds || []) {
          for (const n of namesOf(ev.idx?.byId[id]?.task)) queue(n, { type: 'sprint', text, link })
        }
      }
      if (ev.type === 'completed' && ev.completed) {
        const s = ev.completed
        const sum = s.summary || {}
        const nextName = ev.next?.name
        const text = `${s.name} ${s.autoCompleted ? 'ended' : 'was completed'}: ${sum.completedStories || 0}/${(sum.completedStories || 0) + (sum.carriedStories || 0)} stories done`
          + (sum.carriedStories ? `, ${sum.carriedStories} carried to ${nextName || 'the next sprint'}` : '')
        for (const t of ev.sprintTasks || []) for (const n of namesOf(t)) queue(n, { type: 'sprint', text, link })

        // Whoever owns carried work hears about it specifically: the story's assignees
        // and the assignees of its unfinished sub-tasks.
        for (const story of ev.carried || []) {
          const times = (Number(story.carryOver) || 0) + 1
          const text2 = `“${story.title}” was carried over to ${nextName || 'the next sprint'}${times > 1 ? ` (carried ${times}×)` : ''}`
          const owners = new Set(namesOf(story))
          const stack = [...(ev.idx?.childrenOf[story.id] || [])]
          while (stack.length) {
            const t = ev.idx.byId[stack.pop()]?.task
            if (!t) continue
            if (t.status !== 'done') namesOf(t).forEach(n => owners.add(n))
            stack.push(...(ev.idx.childrenOf[t.id] || []))
          }
          for (const n of owners) queue(n, { type: 'sprint-carry', text: text2, link })
        }
      }
    }
    await Promise.all([...batch].map(([name, entries]) => addNotifications(name, entries)))
  } catch {}
}

module.exports = { notifySprintEvents }
