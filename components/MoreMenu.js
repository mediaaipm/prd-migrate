import { MoreHorizontal } from 'lucide-react'
import { Button } from './ui/button'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from './ui/dropdown-menu'

// A "⋯" button with a small menu — where secondary actions go so they stop competing
// with the page's main ones. Items: [{ label, onClick, danger?, hidden? }]. Renders
// nothing when every item is hidden. Danger items are pushed below a separator.
export default function MoreMenu({ items, label = 'More actions', align = 'right' }) {
  const visible = (items || []).filter(i => i && !i.hidden)
  if (!visible.length) return null
  const safe = visible.filter(i => !i.danger)
  const danger = visible.filter(i => i.danger)

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} title={label}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align === 'left' ? 'start' : 'end'} className="min-w-44">
        {safe.map(item => (
          <DropdownMenuItem key={item.label} onSelect={() => item.onClick()}>{item.label}</DropdownMenuItem>
        ))}
        {safe.length > 0 && danger.length > 0 && <DropdownMenuSeparator />}
        {danger.map(item => (
          <DropdownMenuItem key={item.label} variant="destructive" onSelect={() => item.onClick()}>{item.label}</DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
