import { getProject, listLabels } from '../../../../lib/prd-store'
import { createTask } from '../../../../lib/task-store'
import { requirePermission, requireProjectAccess } from '../../../../lib/require-permission'
import { hasLabel } from '../../../../lib/require-label'

// Import carries labels by id or by name, `;`-separated in CSV. Names because a
// spreadsheet exported from anywhere else has names in it, not our ids — and
// labels are mandatory on create, so an importer with no way to supply them would
// simply be an importer that no longer works.
function resolveLabelIds(raw, labels) {
  const list = Array.isArray(raw)
    ? raw
    : String(raw || '').split(';').map(s => s.trim()).filter(Boolean)
  const byId = new Map(labels.map(l => [l.id, l.id]))
  const byName = new Map(labels.map(l => [l.name.toLowerCase(), l.id]))
  const out = []
  for (const v of list) {
    const id = byId.get(v) || byName.get(String(v).toLowerCase())
    if (id && !out.includes(id)) out.push(id)
  }
  return out
}

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

  const labels = await listLabels(slug).catch(() => [])
  const labelsMandatory = Array.isArray(labels) && labels.length > 0

  if (format === 'csv') {
    if (!content) return res.status(400).json({ error: 'content required for CSV import' })

    const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n')
    if (lines.length < 2) return res.status(400).json({ error: 'CSV must have a header row and at least one data row' })

    const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim())
    const rows = []

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue
      const values = parseCSVLine(line)
      const row = {}
      headers.forEach((h, j) => { row[h] = values[j] !== undefined ? values[j].trim() : '' })
      if (!row.title) continue
      rows.push({ line: i + 1, row, labelIds: resolveLabelIds(row.labels || row.label, labels) })
    }

    // Validated in full before anything is written: a half-finished import that
    // dies on row 180 is worse than one that refuses up front.
    const unlabelled = labelsMandatory ? rows.filter(r => !hasLabel(r.labelIds)) : []
    if (unlabelled.length) {
      return res.status(400).json({
        error: `At least one label is required. ${unlabelled.length} row(s) have none — first at line ${unlabelled[0].line}. Add a "labels" column with label names or ids, separated by ";".`,
      })
    }

    const created = []
    for (const { row, labelIds } of rows) {
      const task = await createTask(slug, version || null, {
        title: row.title,
        description: row.description || '',
        status: row.status || 'todo',
        priority: row.priority || 'medium',
        assignees: row.assignees ? row.assignees.split(';').filter(Boolean) : [],
        startDate: row.startdate || row['start_date'] || null,
        dueDate: row.duedate || row['due_date'] || null,
        // Category id as stored, not the display name — an id that has no
        // definition here still shows up in a flagged rail rather than vanishing.
        category: row.category || null,
        labelIds,
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

  const resolved = tasksToImport.map((t, i) => ({
    t,
    index: i,
    labelIds: resolveLabelIds(t.labelIds || t.labels, labels),
  }))

  const unlabelled = labelsMandatory ? resolved.filter(r => !hasLabel(r.labelIds)) : []
  if (unlabelled.length) {
    return res.status(400).json({
      error: `At least one label is required. ${unlabelled.length} task(s) have none — first is “${unlabelled[0].t.title || 'Untitled'}”. Give each task a labelIds array of label ids, or a labels array of names.`,
    })
  }

  const created = []
  const idMap = {}

  for (const { t, labelIds } of resolved) {
    const newTask = await createTask(slug, version || null, {
      title: t.title || 'Untitled',
      description: t.description || '',
      status: t.status || 'todo',
      priority: t.priority || 'medium',
      assignees: t.assignees || (t.assignee ? [t.assignee] : []),
      startDate: t.startDate || null,
      dueDate: t.dueDate || null,
      category: t.category || null,
      parentId: t.parentId ? (idMap[t.parentId] || null) : null,
      labelIds,
    })
    if (t.id) idMap[t.id] = newTask.id
    created.push(newTask)
  }

  return res.status(200).json({ created: created.length, tasks: created })
}
