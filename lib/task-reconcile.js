// Deciding whether a task write's own response is enough to update the board, or
// whether the whole list has to be refetched.
//
// The task list is the largest payload the app serves (~530 KB at 900 tasks) and it
// used to come back on every single write — status flip, drag, comment. Most writes
// change one task and disturb nothing else, and the server already echoes that task
// back, so the refetch was pure duplication.
//
// The exception is anything that moves a task within the tree: `number` is positional
// (1, 1.1, 1.2 …), so reparenting or reordering silently renumbers other rows. For
// those the single returned task is not enough and the list must be refetched.

// Fields whose change moves a task or renumbers its siblings.
const RESHAPING_FIELDS = ['parentId', 'numberOverride', 'seq', 'order', 'boardOrder']

// Empty string, null and undefined all mean "not set" here — the edit form round-trips
// `numberOverride` as '' where the server stores null. Comparing on presence alone
// would make every modal save look structural and refetch for nothing.
const unset = v => v === '' || v === null || v === undefined

function sameFieldValue(a, b) {
  if (unset(a) && unset(b)) return true
  return String(a) === String(b)
}

// `body` is the PUT payload, `prev` the task as the client last knew it.
function reshapesTree(body, prev) {
  if (!body || typeof body !== 'object') return true // unknown shape — play it safe
  if (!prev) return true                             // nothing to compare against
  return RESHAPING_FIELDS.some(f => f in body && !sameFieldValue(body[f], prev[f]))
}

module.exports = { reshapesTree, sameFieldValue, RESHAPING_FIELDS }
