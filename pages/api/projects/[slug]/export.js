import { getProject, listVersions, getVersion } from '../../../../lib/prd-store'
import { listTasks } from '../../../../lib/task-store'

function csvEscape(val) {
  if (val === null || val === undefined) return ''
  const s = String(val)
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const { slug, format = 'json', version } = req.query

  const project = await getProject(slug)
  if (!project) return res.status(404).json({ error: 'Project not found' })

  if (format === 'csv') {
    const tasks = await listTasks(slug, version || null)
    const headers = ['number', 'title', 'status', 'priority', 'assignees', 'startDate', 'dueDate', 'description']
    const rows = tasks.map(t => [
      csvEscape(t.number || t.autoNumber || ''),
      csvEscape(t.title || ''),
      csvEscape(t.status || ''),
      csvEscape(t.priority || ''),
      csvEscape((t.assignees || []).join(';')),
      csvEscape(t.startDate || ''),
      csvEscape(t.dueDate || ''),
      csvEscape(t.description || ''),
    ])
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n')
    const filename = `${slug}-tasks${version ? `-v${version}` : ''}.csv`
    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    return res.status(200).send(csv)
  }

  // JSON — full project export
  const versions = await listVersions(slug)
  const prdVersions = await Promise.all(versions.map(v => getVersion(slug, v.version)))

  const rootTasks = await listTasks(slug, null)
  const versionTasksMap = {}
  for (const v of versions) {
    const vt = await listTasks(slug, v.version)
    if (vt.length > 0) versionTasksMap[v.version] = vt
  }

  const payload = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    project: {
      slug: project.slug,
      name: project.name,
      description: project.description,
      status: project.status,
      priority: project.priority,
      members: project.members || [],
    },
    prdVersions: prdVersions.filter(Boolean),
    tasks: {
      __root: rootTasks,
      ...versionTasksMap,
    },
    proposals: project.proposals || [],
  }

  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Content-Disposition', `attachment; filename="${slug}-prd.json"`)
  return res.status(200).json(payload)
}
