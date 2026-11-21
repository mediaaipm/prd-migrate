// Story points use the Fibonacci scale. The gaps grow with size on purpose: past a few
// points nobody can tell a 6 from a 7, only "about 5" from "about 8". Anything bigger
// than the top value is a story to split, not to estimate.
//
// Blank means unestimated (counts as 1 in velocity — see lib/sprints.js pointsOf).
// Estimates saved before the scale existed are kept as they are until someone changes
// them; only a NEW value has to be on the scale (lib/task-store.js updateTask).
const FIBONACCI_POINTS = [1, 2, 3, 5, 8, 13, 21]

function isFibonacciPoints(v) {
  return FIBONACCI_POINTS.includes(Number(v))
}

// The nearest scale value at or above `v` — for creates and imports, where there is
// no earlier estimate to preserve. null stays null (unestimated).
function snapToFibonacci(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return null
  return FIBONACCI_POINTS.find(p => p >= n) ?? FIBONACCI_POINTS[FIBONACCI_POINTS.length - 1]
}

module.exports = { FIBONACCI_POINTS, isFibonacciPoints, snapToFibonacci }
