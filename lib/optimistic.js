// Replays not-yet-synced queue items on top of server data.
//
// A view renders `applyPending(serverList, pending, {...})` rather than the raw
// server list. Because the pending ops are re-applied on every render, a refetch
// that lands before the queue has drained cannot make the user's change disappear
// and then reappear. It also means the optimistic view is reconstructed from
// localStorage on page load, with no extra work from the caller.

import { useEffect, useState } from 'react'
import { getPending, subscribe } from './submit-queue'

// Tasks cascade: deleting a parent removes its subtree, matching deleteTask() on the
// server. Without this a queued parent-delete would leave orphans on screen until
// the refetch landed.
function withDescendants(list, id, key) {
  const doomed = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const row of list) {
      if (row.parentId && doomed.has(row.parentId) && !doomed.has(row[key])) {
        doomed.add(row[key])
        grew = true
      }
    }
  }
  return doomed
}

/**
 * @param {Array} serverList  rows as last fetched
 * @param {Array} pending     items from getPending()
 * @param {object} opts
 * @param {string} opts.entity   e.g. 'task' — matches item.optimistic.entity
 * @param {string} [opts.scope]  e.g. the apiBase, so one project's queue doesn't leak into another's list
 * @param {string} [opts.key]    id field (default 'id'; 'name' for users/assignees)
 * @param {boolean} [opts.cascade] delete children of a deleted row (tasks)
 */
export function applyPending(serverList, pending, { entity, scope, key = 'id', cascade = false } = {}) {
  const ops = pending
    .map(i => i.optimistic)
    .filter(o => o && o.entity === entity && (scope === undefined || o.scope === scope))

  if (!ops.length) return serverList

  let list = serverList.slice()

  for (const op of ops) {
    if (op.op === 'create') {
      // A replayed create can race a refetch that already contains the row.
      if (list.some(r => r[key] === op.data[key])) continue
      list.push({ ...op.data, _pending: true })
    } else if (op.op === 'update') {
      list = list.map(r => (r[key] === op.id ? { ...r, ...op.patch, _pending: true } : r))
    } else if (op.op === 'updateMany') {
      // One request that repositions several rows at once — a board reorder, a drag
      // that renumbers siblings, an undo that restores a whole subtree.
      list = list.map(r => (op.patches[r[key]] ? { ...r, ...op.patches[r[key]], _pending: true } : r))
    } else if (op.op === 'delete') {
      const doomed = cascade ? withDescendants(list, op.id, key) : new Set([op.id])
      list = list.filter(r => !doomed.has(r[key]))
    }
  }

  return list
}

/**
 * Server list in, optimistic list out. Re-runs whenever the queue changes.
 * Pass the same `opts` you would pass to applyPending.
 */
export function useOptimistic(serverList, opts) {
  const [pending, setPending] = useState([])

  useEffect(() => {
    // getPending() decides what still counts as unsettled (queued *and* accepted-but-
    // not-yet-refetched); don't re-implement that filter here or an accepted write
    // would leave the overlay early and the row would flash its old value.
    setPending(getPending())
    return subscribe(() => setPending(getPending()))
  }, [])

  return applyPending(serverList || [], pending, opts)
}
