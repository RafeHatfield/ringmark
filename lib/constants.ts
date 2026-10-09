import type { ObjectType, ObjectStatus, SpeciesConfidence, LineageConfidence } from './types'

export const OBJECT_TYPES: { value: ObjectType; label: string }[] = [
  { value: 'source', label: 'Source' },
  { value: 'log', label: 'Log' },
  { value: 'chunk', label: 'Chunk' },
  { value: 'slab', label: 'Slab' },
  { value: 'blank', label: 'Blank' },
  { value: 'rough_bowl', label: 'Rough Bowl' },
  { value: 'finished_bowl', label: 'Finished Bowl' },
  { value: 'pen_blank', label: 'Pen Blank' },
  { value: 'spindle_blank', label: 'Spindle Blank' },
  { value: 'offcut', label: 'Offcut' },
  { value: 'other', label: 'Other' },
]

const OBJECT_TYPE_LABELS = new Map(OBJECT_TYPES.map((t) => [t.value, t.label]))

export function typeLabel(value: string): string {
  return OBJECT_TYPE_LABELS.get(value as ObjectType) ?? value
}

export const OBJECT_STATUSES: { value: ObjectStatus; label: string }[] = [
  { value: 'unknown', label: 'Unknown' },
  { value: 'acquired', label: 'Acquired' },
  { value: 'stored', label: 'Stored' },
  { value: 'sealed', label: 'Sealed' },
  { value: 'cut', label: 'Cut' },
  { value: 'drying', label: 'Drying' },
  { value: 'rough_turned', label: 'Rough Turned' },
  { value: 'finished', label: 'Finished' },
  { value: 'for_sale', label: 'For Sale' },
  { value: 'sold', label: 'Sold' },
  { value: 'gifted', label: 'Gifted' },
  { value: 'scrapped', label: 'Scrapped' },
]

/**
 * Statuses that mean "this is a finished piece", not a stage on the way to one.
 * The maker page lists only these; a published log or blank still has its own
 * /p/[slug] story page, it just doesn't belong in the portfolio.
 */
export const FINISHED_STATUSES: ObjectStatus[] = ['finished', 'for_sale', 'sold', 'gifted']

export const SPECIES_CONFIDENCE_LEVELS: { value: SpeciesConfidence; label: string }[] = [
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'likely', label: 'Likely' },
  { value: 'guessed', label: 'Guessed' },
  { value: 'unknown', label: 'Unknown' },
]

export const LINEAGE_CONFIDENCE_LEVELS: { value: LineageConfidence; label: string }[] = [
  { value: 'exact', label: 'Exact' },
  { value: 'probable', label: 'Probable' },
  { value: 'batch_level', label: 'Batch Level' },
  { value: 'unknown', label: 'Unknown' },
]

export const DEFAULT_CARE_INSTRUCTIONS =
  'A wipe with a damp cloth, never the dishwasher, and a little food-safe oil when the wood looks dry. Don\'t overthink it - wood is hardy and resilient, and everything I make is meant to be used.'

export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://ringmark.org'
export const SIGNED_URL_EXPIRY = 3600

/**
 * Lifetime of the signed photo URLs baked into the cached public story page.
 *
 * The page is ISR-cached and Next serves it stale-while-revalidating, so a
 * page that sat unviewed for a month is served as-is to the next scanner
 * before it regenerates. Any URL inside it must therefore outlive any
 * plausible idle gap, or that buyer sees broken images — the normal case for
 * a bowl scanned weeks after it sold. One year.
 *
 * What this does not weaken: private photos are never signed for the public
 * page at all, and every write purges the page, so a photo that is hidden or
 * deleted leaves the page immediately. The only residue is that someone who
 * saved the old URL while the photo was public can still fetch it for the
 * remainder of the year — which is no more than they could do by saving the
 * image itself while it was public.
 */
export const PUBLIC_PHOTO_URL_EXPIRY = 60 * 60 * 24 * 365
export const MAX_VISIBLE_PHOTOS = 3
