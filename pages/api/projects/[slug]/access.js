const { requireProjectAccess } = require('../../../../lib/require-permission')
const { getEffectiveRolePolicy } = require('../../../../lib/role-policy')

// The effective role policy for this project, readable by any project member.
// The client uses it to scope permission/status affordances per project. This is
// not sensitive (it only says which perms/statuses a role has); enforcement lives
// in the mutation routes.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const { slug } = req.query
  if (!await requireProjectAccess(slug, req, res)) return
  const { user, admin, userRestrictedStatuses } = await getEffectiveRolePolicy(slug)
  return res.json({ user, admin, userRestrictedStatuses })
}
