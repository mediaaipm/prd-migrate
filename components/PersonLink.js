import Link from 'next/link'
import { useCurrentUser } from './AppShell'
import { canOpenProfile } from '../lib/roles'

export const profileHref = name => `/people/${encodeURIComponent(name)}`

// A person's name (or avatar) that opens their performance page (/people/{name}).
// Plain text for viewers who may not open it (lib/roles.js canOpenProfile). Safe inside
// clickable rows and draggable cards: the click never reaches the row, and the link
// itself is not draggable.
export default function PersonLink({ name, className = '', title, style, children }) {
  const user = useCurrentUser()
  const content = children ?? name
  if (!name || !canOpenProfile(user, name)) {
    return <span className={className} title={title} style={style}>{content}</span>
  }
  const stop = e => e.stopPropagation()
  return (
    <Link
      href={profileHref(name)}
      className={`person-link ${className}`.trim()}
      title={title || `${name} — view performance`}
      style={style}
      draggable={false}
      onClick={stop}
      onMouseDown={stop}
      onPointerDown={stop}
      onKeyDown={stop}
    >
      {content}
    </Link>
  )
}
