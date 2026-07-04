import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getWorkshopName(
  account: { workshop_name?: string | null; display_name?: string | null; name?: string | null } | null,
): string {
  return account?.workshop_name || account?.display_name || account?.name || 'Ringmark'
}

// Sanitizes free-text search input before it's interpolated into a PostgREST
// `.or()` / `.ilike()` filter string: strips characters that break the filter
// syntax (`,`, `(`, `)`, `"`) and escapes ilike wildcards so `%`/`_` in the
// query are treated literally rather than as pattern matches.
export function sanitizeSearch(q: string): string {
  return q
    .trim()
    .slice(0, 100)
    .replace(/[,()"]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
}
