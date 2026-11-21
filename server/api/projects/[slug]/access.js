const { requireProjectAccess } = require('../../../../lib/require-permission')
const { getEffectiveRolePolicy } = require('../../../../lib/role-policy')
const { ceilingFor } = require('../../../../lib/roles')
const { getUserAccess } = require('../../../../lib/user-access')
const { getSessionUser } = require('../../../../lib/session')
const { ALL_PERMISSIONS } = require('../../../../lib/permissions')
const { sendJsonConfig } = require('../../../../lib/etag')

// The effective role policy for this project, plus what the CALLER may do here
// (their personal + group grant capped by the policy). The client uses it to scope
// permission/status affordances per project. This is not sensitive; enforcement
// lives in the mutation routes.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const { slug } = req.query
  if (!await requireProjectAccess(slug, req, res)) return

  const policy = await getEffectiveRolePolicy(slug)
  const { user, admin, userRestrictedStatuses } = policy
  const me = getSessionUser(req) || {}
  const isSuper = me.role === 'superadmin' || (me.isAdmin === true && !me.role)

  let effective
  if (isSuper) {
    effective = ALL_PERMISSIONS
  } else {
    const access = await getUserAccess(me.name)
    const ceiling = ceilingFor(policy, me.role)
    effective = (access.permissions || ceiling).filter(p => ceiling.includes(p))
  }

  // Browser-cached for a minute: it only drives which buttons the UI shows. A grant
  // change reaches the UI within that window; the server enforces it immediately.
  const { v, ...buckets } = policy
  return sendJsonConfig(res, { ...buckets, user, admin, userRestrictedStatuses, effective })
}
