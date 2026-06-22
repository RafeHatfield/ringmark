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
