const { Redis } = require('@upstash/redis')
let _kv;
function getKv() { if (!_kv) _kv = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN }); return _kv; }
const { listProjects, getProject } = require('./prd-store')
const { listTasks } = require('./task-store')

async function createSnapshot(label, user) {
  const id = `snap-${Date.now()}`
  const projectList = await listProjects()
  const projects = []

  for (const p of projectList) {
    const full = await getProject(p.slug)
    const tasks = {}
    tasks['__root'] = await listTasks(p.slug, null)
    for (const v of (full.versions || [])) {
      tasks[v.version] = await listTasks(p.slug, v.version)
    }
    projects.push({ ...full, tasks })
  }

  const snapshot = {
    id,
    label: label || `Snapshot ${new Date().toISOString().slice(0, 10)}`,
    createdAt: new Date().toISOString(),
    createdBy: user || null,
    projects,
  }

  await getKv().set(`snapshot:${id}`, snapshot)
  await getKv().sadd('snapshots', id)
  return snapshot
}

async function listSnapshots() {
  const ids = await getKv().smembers('snapshots')
  if (!ids || !ids.length) return []
  const items = await getKv().mget(...ids.map(id => `snapshot:${id}`))
  return items
    .filter(Boolean)
    .map(s => ({
      id: s.id,
      label: s.label,
      createdAt: s.createdAt,
      createdBy: s.createdBy,
      projectCount: s.projects?.length || 0,
    }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
}

async function getSnapshot(id) {
  return getKv().get(`snapshot:${id}`)
}

// The admin Snapshots tab only renders per-project counts, but a snapshot embeds
// every version's markdown and every task — including inline base64 attachments.
// Sending the whole thing to draw three numbers was a large, one-click transfer
// hit, so the detail route returns this unless ?full=1 is asked for.
function summarizeSnapshot(snapshot) {
  if (!snapshot) return snapshot
  return {
    id: snapshot.id,
    label: snapshot.label,
    createdAt: snapshot.createdAt,
    createdBy: snapshot.createdBy,
    projects: (snapshot.projects || []).map(p => ({
      slug: p.slug,
      name: p.name,
      // Length is all the UI reads; the bodies are what made this expensive.
      versions: (p.versions || []).map(v => ({ version: v.version })),
      proposals: (p.proposals || []).map(pr => ({ id: pr.id, status: pr.status })),
      taskCount: Object.values(p.tasks || {}).reduce((n, list) => n + (Array.isArray(list) ? list.length : 0), 0),
    })),
  }
}

async function deleteSnapshot(id) {
  await getKv().srem('snapshots', id)
  await getKv().del(`snapshot:${id}`)
}

module.exports = { createSnapshot, listSnapshots, getSnapshot, summarizeSnapshot, deleteSnapshot }
