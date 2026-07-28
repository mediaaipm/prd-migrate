const { requireProjectAccess } = require('../../../../lib/require-permission')
const { getEffectiveRolePolicy } = require('../../../../lib/role-policy')
const { getUserAccess } = require('../../../../lib/user-access')
const { getSessionUser } = require('../../../../lib/session')
const { ALL_PERMISSIONS } = require('../../../../lib/permissions')

// The effective role policy for this project, plus what the CALLER may do here
// (their personal + group grant capped by the policy). The client uses it to scope
// permission/status affordances per project. This is not sensitive; enforcement
// lives in the mutation routes.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const { slug } = req.query
  if (!await requireProjectAccess(slug, req, res)) return

  const { user, admin, userRestrictedStatuses } = await getEffectiveRolePolicy(slug)
  const me = getSessionUser(req) || {}
  const isSuper = me.role === 'superadmin' || (me.isAdmin === true && !me.role)

  let effective
  if (isSuper) {
    effective = ALL_PERMISSIONS
  } else {
    const access = await getUserAccess(me.name)
    const ceiling = me.role === 'admin' ? admin : user
    effective = (access.permissions || ceiling).filter(p => ceiling.includes(p))
  }

  return res.json({ user, admin, userRestrictedStatuses, effective })
}
