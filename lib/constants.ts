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
export const MAX_VISIBLE_PHOTOS = 3
