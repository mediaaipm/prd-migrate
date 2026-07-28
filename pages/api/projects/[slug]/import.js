import { getProject } from '../../../../lib/prd-store'
import { createTask } from '../../../../lib/task-store'
import { requirePermission, requireProjectAccess } from '../../../../lib/require-permission'

function parseCSVLine(line) {
  const result = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      result.push(current); current = ''
    } else {
      current += char
    }
  }
  result.push(current)
  return result
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { slug, version } = req.query

  // Same hole export.js had, on the write side: anyone who could guess a slug could
  // bulk-create tasks in that project. Gated like POST /tasks.
  if (!await requireProjectAccess(slug, req, res)) return
  if (!await requirePermission('task:create', slug)(req, res)) return

  const project = await getProject(slug)
  if (!project) return res.status(404).json({ error: 'Project not found' })

  const { format, content, data } = req.body || {}

  if (format === 'csv') {
    if (!content) return res.status(400).json({ error: 'content required for CSV import' })

    const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n')
    if (lines.length < 2) return res.status(400).json({ error: 'CSV must have a header row and at least one data row' })

    const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim())
    const created = []

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue
      const values = parseCSVLine(line)
      const row = {}
      headers.forEach((h, j) => { row[h] = values[j] !== undefined ? values[j].trim() : '' })

      if (!row.title) continue

      const task = await createTask(slug, version || null, {
        title: row.title,
        description: row.description || '',
        status: row.status || 'todo',
        priority: row.priority || 'medium',
        assignees: row.assignees ? row.assignees.split(';').filter(Boolean) : [],
        startDate: row.startdate || row['start_date'] || null,
        dueDate: row.duedate || row['due_date'] || null,
      })
      created.push(task)
    }

    return res.status(200).json({ created: created.length, tasks: created })
  }

  // JSON import
  if (!data) return res.status(400).json({ error: 'data required for JSON import' })

  const tasksToImport = Array.isArray(data)
    ? data
    : (data.tasks?.__root || (data.tasks && Array.isArray(data.tasks) ? data.tasks : []))

  if (!Array.isArray(tasksToImport)) return res.status(400).json({ error: 'Invalid tasks format — expected array or { tasks: { __root: [] } }' })

  const created = []
  const idMap = {}

  for (const t of tasksToImport) {
    const newTask = await createTask(slug, version || null, {
      title: t.title || 'Untitled',
      description: t.description || '',
      status: t.status || 'todo',
      priority: t.priority || 'medium',
      assignees: t.assignees || (t.assignee ? [t.assignee] : []),
      startDate: t.startDate || null,
      dueDate: t.dueDate || null,
      parentId: t.parentId ? (idMap[t.parentId] || null) : null,
    })
    if (t.id) idMap[t.id] = newTask.id
    created.push(newTask)
  }

  return res.status(200).json({ created: created.length, tasks: created })
}
