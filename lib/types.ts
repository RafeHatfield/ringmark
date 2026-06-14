export type ObjectType =
  | 'source'
  | 'log'
  | 'chunk'
  | 'slab'
  | 'blank'
  | 'rough_bowl'
  | 'finished_bowl'
  | 'pen_blank'
  | 'spindle_blank'
  | 'offcut'
  | 'other'

export type ObjectStatus =
  | 'unknown'
  | 'acquired'
  | 'stored'
  | 'sealed'
  | 'cut'
  | 'drying'
  | 'rough_turned'
  | 'finished'
  | 'for_sale'
  | 'sold'
  | 'gifted'
  | 'scrapped'

export type SpeciesConfidence = 'confirmed' | 'likely' | 'guessed' | 'unknown'
export type LineageConfidence = 'exact' | 'probable' | 'batch_level' | 'unknown'

export interface Account {
  id: string
  owner_user_id: string
  name: string
  default_prefix: string
  created_at: string
  updated_at: string
}

export type AccountInsert = Omit<Account, 'id' | 'created_at' | 'updated_at'> &
  Partial<Pick<Account, 'id' | 'created_at' | 'updated_at'>>

export type AccountUpdate = Partial<AccountInsert>

export interface WoodObject {
  id: string
  account_id: string
  workshop_id: string
  workshop_id_lower: string
  public_slug: string
  object_type: ObjectType
  status: ObjectStatus | null
  title: string | null
  species: string | null
  species_confidence: SpeciesConfidence | null
  parent_id: string | null
  root_id: string | null
  lineage_confidence: LineageConfidence | null
  dimensions_text: string | null
  finish: string | null
  location_text: string | null
  private_notes: string | null
  public_notes: string | null
  public_title: string | null
  public_story: string | null
  public_care: string | null
  is_published: boolean
  created_at: string
  updated_at: string
}

export type WoodObjectInsert = Omit<WoodObject, 'id' | 'created_at' | 'updated_at'> &
  Partial<Pick<WoodObject, 'id' | 'created_at' | 'updated_at'>>

export type WoodObjectUpdate = Partial<WoodObjectInsert>

export interface ObjectPhoto {
  id: string
  account_id: string
  object_id: string
  storage_path: string
  caption: string | null
  is_public: boolean
  sort_order: number
  captured_at: string | null
  created_at: string
  updated_at: string
}

export type ObjectPhotoInsert = Omit<ObjectPhoto, 'id' | 'created_at' | 'updated_at'> &
  Partial<Pick<ObjectPhoto, 'id' | 'created_at' | 'updated_at'>>

export type ObjectPhotoUpdate = Partial<ObjectPhotoInsert>

export interface Database {
  public: {
    Tables: {
      accounts: {
        Row: Account
        Insert: AccountInsert
        Update: AccountUpdate
      }
      wood_objects: {
        Row: WoodObject
        Insert: WoodObjectInsert
        Update: WoodObjectUpdate
      }
      object_photos: {
        Row: ObjectPhoto
        Insert: ObjectPhotoInsert
        Update: ObjectPhotoUpdate
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
  }
}
