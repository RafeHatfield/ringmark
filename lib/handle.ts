/** Converts a workshop name into a suggested URL handle. */
export function slugifyHandle(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
}

/** Returns true if the string is a valid account handle. */
export function isValidHandle(handle: string): boolean {
  return (
    /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(handle) &&
    handle.length >= 2 &&
    handle.length <= 50
  )
}
