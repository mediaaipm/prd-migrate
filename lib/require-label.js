const { listLabels } = require('./prd-store')

// Every task must carry at least one label. Enforced here rather than only in the
// forms because the forms are not the only writer — import, a stale tab and any
// script hitting the API all land on the same routes.
//
// Two deliberate escape hatches:
//   * a project with no labels configured is exempt, otherwise nobody could ever
//     create the first task in a new project;
//   * only *creates* are checked. Every task that predates this rule is unlabelled,
//     and gating updates would make those tasks uneditable — including uneditable
//     for the one edit that would fix them.
async function labelsRequired(slug) {
  try {
    const labels = await listLabels(slug)
    return Array.isArray(labels) && labels.length > 0
  } catch {
    // The label list is unreadable — refuse to invent a rule out of an outage.
    return false
  }
}

function hasLabel(labelIds) {
  return Array.isArray(labelIds) && labelIds.some(id => typeof id === 'string' && id.trim())
}

// Returns an error message, or null when the create may proceed.
async function checkLabels(slug, labelIds) {
  if (hasLabel(labelIds)) return null
  if (!await labelsRequired(slug)) return null
  return 'At least one label is required'
}

// Route helper: writes the 400 itself and answers false when the caller should stop.
async function requireLabels(slug, labelIds, res) {
  const err = await checkLabels(slug, labelIds)
  if (!err) return true
  res.status(400).json({ error: err })
  return false
}

module.exports = { labelsRequired, hasLabel, checkLabels, requireLabels }
