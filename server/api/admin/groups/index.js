const { requireSuperAdmin } = require('../../../../lib/require-superadmin')
const { listGroups, createGroup, GroupError } = require('../../../../lib/group-store')
const { logAudit } = require('../../../../lib/audit-log')

// Group management. Superadmin only — groups hand out permissions, so nobody who
// is subject to them may edit them.
export default async function handler(req, res) {
  if (!requireSuperAdmin(req, res)) return

  if (req.method === 'GET') {
    return res.json(await listGroups())
  }

  if (req.method === 'POST') {
    const { name, description, permissions, assignedProjects, members } = req.body || {}
    try {
      const group = await createGroup({ name, description, permissions, assignedProjects, members })
      await logAudit(req, 'create_group', 'group', { id: group.id, name: group.name })
      return res.status(201).json(group)
    } catch (err) {
      if (err instanceof GroupError) return res.status(err.status).json({ error: err.message })
      throw err
    }
  }

  res.status(405).end()
}
