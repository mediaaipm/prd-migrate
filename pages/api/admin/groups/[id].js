const { requireSuperAdmin } = require('../../../../lib/require-superadmin')
const {
  getGroup,
  updateGroup,
  deleteGroup,
  addMembers,
  removeMember,
  GroupError,
} = require('../../../../lib/group-store')
const { logAudit } = require('../../../../lib/audit-log')

// One group. Superadmin only.
//   PUT   { name?, description?, permissions?, assignedProjects?, members? }
//   PATCH { addMembers?: string[], removeMember?: string }  — membership only
export default async function handler(req, res) {
  if (!requireSuperAdmin(req, res)) return
  const { id } = req.query

  try {
    if (req.method === 'GET') {
      const group = await getGroup(id)
      if (!group) return res.status(404).json({ error: 'Group not found.' })
      return res.json(group)
    }

    if (req.method === 'PUT') {
      const { name, description, permissions, assignedProjects, members } = req.body || {}
      const group = await updateGroup(id, { name, description, permissions, assignedProjects, members })
      await logAudit(req, 'update_group', 'group', { id, name: group.name, permissions: group.permissions, members: group.members })
      return res.json(group)
    }

    if (req.method === 'PATCH') {
      const body = req.body || {}
      let group
      if (Array.isArray(body.addMembers) && body.addMembers.length) {
        group = await addMembers(id, body.addMembers)
        await logAudit(req, 'update_group_members', 'group', { id, added: body.addMembers })
      }
      if (body.removeMember) {
        group = await removeMember(id, body.removeMember)
        await logAudit(req, 'update_group_members', 'group', { id, removed: body.removeMember })
      }
      if (!group) return res.status(400).json({ error: 'addMembers or removeMember required' })
      return res.json(group)
    }

    if (req.method === 'DELETE') {
      const ok = await deleteGroup(id)
      if (!ok) return res.status(404).json({ error: 'Group not found.' })
      await logAudit(req, 'delete_group', 'group', { id })
      return res.status(204).end()
    }
  } catch (err) {
    if (err instanceof GroupError) return res.status(err.status).json({ error: err.message })
    throw err
  }

  res.status(405).end()
}
