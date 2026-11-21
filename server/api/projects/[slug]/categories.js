const { getTaskCategories, setTaskCategories } = require('../../../../lib/prd-store')
const { logAudit } = require('../../../../lib/audit-log')
const { requireProjectAccess } = require('../../../../lib/require-permission')
const { requireSuperAdmin } = require('../../../../lib/require-superadmin')
const { sendJsonConfig } = require('../../../../lib/etag')

// Categories are global per project, exactly like board columns: everyone reads
// them, only a super admin writes them. The rails on the board are therefore the
// same for every user, which is the whole point of making a category a shared
// field instead of a per-story task.
export default async function handler(req, res) {
  const { slug } = req.query
  if (!await requireProjectAccess(slug, req, res)) return

  if (req.method === 'GET') {
    return sendJsonConfig(res, { categories: await getTaskCategories(slug) || [] })
  }
  if (req.method === 'PUT') {
    if (!requireSuperAdmin(req, res)) return
    const categories = await setTaskCategories(slug, (req.body || {}).categories)
    if (!categories) return res.status(400).json({ error: 'categories must be an array of { id, name, color }' })
    await logAudit(req, 'update_categories', 'project', { slug, order: categories.map(c => c.id) })
    return res.status(200).json({ categories })
  }
  res.status(405).json({ error: 'Method not allowed' })
}
