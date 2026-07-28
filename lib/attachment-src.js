// Resolving an attachment to something an <img src> can use.
//
// An attachment has bytes in exactly one of two places depending on where it came
// from:
//   - just picked in the form  -> `dataUrl`, local, not saved yet
//   - loaded from the server   -> `url`, pointing at the media route
// Everything that renders an attachment goes through attSrc() so both work.
//
// Covers are stored as a reference (`attId`) rather than a second copy of the
// bytes, so coverSrc() has to look the attachment up on the task. `cover.dataUrl`
// is only present on legacy records written before that change.

export function attSrc(att) {
  if (!att) return null
  return att.url || att.dataUrl || null
}

export function coverSrc(task) {
  const cover = task?.cover
  if (!cover) return null
  if (cover.url) return cover.url
  if (cover.attId) {
    const att = (task.attachments || []).find(a => a && a.id === cover.attId)
    const src = attSrc(att)
    if (src) return src
  }
  return cover.dataUrl || null
}

export function hasCover(task) {
  return !!coverSrc(task)
}
