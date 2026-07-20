const { requireSuperAdmin } = require('../../../lib/require-superadmin')
const {
  getGlobalRolePolicy,
  getProjectPolicyRaw,
  getEffectiveRolePolicy,
  setGlobalRolePolicy,
  setProjectRolePolicy,
  clearProjectRolePolicy,
} = require('../../../lib/role-policy')
const { logAudit } = require('../../../lib/audit-log')

// Role policy management. Superadmin only.
//   no ?slug   -> the global default policy
//   ?slug=foo  -> that project's override (custom flag tells the UI if it's set)
export default async function handler(req, res) {
  if (!requireSuperAdmin(req, res)) return
  const slug = (req.query.slug || '').trim() || null

  if (req.method === 'GET') {
    if (!slug) return res.json({ scope: 'global', custom: true, policy: await getGlobalRolePolicy() })
    const own = await getProjectPolicyRaw(slug)
    // effective = own override, else the global default it inherits
    return res.json({ scope: slug, custom: !!own, policy: own || await getEffectiveRolePolicy(slug) })
  }

  if (req.method === 'PUT') {
    const { user, admin } = req.body || {}
    if (!Array.isArray(user) || !Array.isArray(admin)) {
      return res.status(400).json({ error: 'user and admin permission arrays required' })
    }
    const saved = slug
      ? await setProjectRolePolicy(slug, req.body)
      : await setGlobalRolePolicy(req.body)
    await logAudit(req, 'update_role_policy', 'policy', { scope: slug || 'global', ...saved })
    return res.json({ scope: slug || 'global', custom: true, policy: saved })
  }

  // Drop a project's override so it inherits the global default again.
  if (req.method === 'DELETE') {
    if (!slug) return res.status(400).json({ error: 'slug required to reset a project policy' })
    await clearProjectRolePolicy(slug)
    await logAudit(req, 'reset_role_policy', 'policy', { scope: slug })
    return res.json({ scope: slug, custom: false, policy: await getEffectiveRolePolicy(slug) })
  }

  res.status(405).end()
}
