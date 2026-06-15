/**
 * Pure utilities for photo ordering — testable without Supabase.
 */

export type PhotoOrder = { id: string; sort_order: number }

/** Returns the next sort_order value after the current maximum. */
export function nextSortOrder(existingOrders: number[]): number {
  if (existingOrders.length === 0) return 0
  return Math.max(...existingOrders) + 1
}

/**
 * Given a list of photos (any order), returns the [moving, swap] pair
 * needed to move `photoId` up or down, or null if the move is invalid.
 */
export function getSwapPair(
  photos: PhotoOrder[],
  photoId: string,
  direction: 'up' | 'down',
): [PhotoOrder, PhotoOrder] | null {
  const sorted = [...photos].sort((a, b) => a.sort_order - b.sort_order)
  const idx = sorted.findIndex((p) => p.id === photoId)
  if (idx === -1) return null
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1
  if (swapIdx < 0 || swapIdx >= sorted.length) return null
  return [sorted[idx], sorted[swapIdx]]
}
