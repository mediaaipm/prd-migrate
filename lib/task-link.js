// Absolute share link for a task: current origin + path, current version, plus ?task=<id>.
// Absolute so the copied string is pasteable straight into a browser or a chat message.
export function taskShareLink(id) {
  if (typeof window === 'undefined') return ''
  const params = new URLSearchParams(window.location.search)
  params.set('task', id)
  return `${window.location.origin}${window.location.pathname}?${params}`
}

// Copies `text` to the clipboard, falling back to a prompt when the clipboard API is
// unavailable (insecure origin, denied permission). Resolves false if the user cancels.
export async function copyText(text) {
  if (!text) return false
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    window.prompt('Copy:', text)
    return false
  }
}
