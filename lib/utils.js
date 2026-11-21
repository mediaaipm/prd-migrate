import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

// shadcn's class combiner: later Tailwind classes win over earlier conflicting ones.
export function cn(...inputs) {
  return twMerge(clsx(inputs))
}
