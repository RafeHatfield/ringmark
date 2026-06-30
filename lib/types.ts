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

export type Account = {
  id: string
  owner_user_id: string
  name: string
  default_prefix: string
  handle: string | null
  display_name: string | null
  workshop_name: string | null
  bio: string | null
  avatar_storage_path: string | null
  website_url: string | null
  created_at: string
  updated_at: string
}

export type AccountInsert = Omit<Account, 'id' | 'created_at' | 'updated_at'> &
  Partial<Pick<Account, 'id' | 'created_at' | 'updated_at'>>

export type AccountUpdate = Partial<AccountInsert>

export type WoodObject = {
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

export type WoodObjectInsert = {
  account_id: string
  workshop_id: string
  workshop_id_lower: string
  public_slug: string
  object_type: ObjectType
  id?: string
  status?: ObjectStatus | null
  title?: string | null
  species?: string | null
  species_confidence?: SpeciesConfidence | null
  parent_id?: string | null
  root_id?: string | null
  lineage_confidence?: LineageConfidence | null
  dimensions_text?: string | null
  finish?: string | null
  location_text?: string | null
  private_notes?: string | null
  public_notes?: string | null
  public_title?: string | null
  public_story?: string | null
  public_care?: string | null
  is_published?: boolean
  created_at?: string
  updated_at?: string
}

export type WoodObjectUpdate = Partial<WoodObjectInsert>

export type ObjectPhoto = {
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

export type ObjectPhotoInsert = {
  account_id: string
  object_id: string
  storage_path: string
  id?: string
  caption?: string | null
  is_public?: boolean
  sort_order?: number
  captured_at?: string | null
  created_at?: string
  updated_at?: string
}

export type ObjectPhotoUpdate = Partial<ObjectPhotoInsert>

export type AccountMember = {
  account_id: string
  user_id: string
  role: 'owner' | 'member'
  joined_at: string
}

export type ApiKey = {
  id: string
  account_id: string
  key_hash: string
  key_prefix: string
  label: string | null
  created_by: string
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

export type ApiKeyInsert = {
  account_id: string
  key_hash: string
  key_prefix: string
  created_by: string
  label?: string | null
}

export type ApiKeyUpdate = {
  label?: string | null
  last_used_at?: string | null
  revoked_at?: string | null
}

export type AccountInvite = {
  id: string
  account_id: string
  created_by: string
  expires_at: string
  claimed_at: string | null
  claimed_by: string | null
}

export type AccountInviteInsert = {
  account_id: string
  created_by: string
  id?: string
  expires_at?: string
  claimed_at?: string | null
  claimed_by?: string | null
}

export interface Database {
  public: {
    Tables: {
      accounts: {
        Row: Account
        Insert: AccountInsert
        Update: AccountUpdate
        Relationships: []
      }
      account_members: {
        Row: AccountMember
        Insert: Omit<AccountMember, 'joined_at'> & { joined_at?: string }
        Update: Partial<AccountMember>
        Relationships: []
      }
      account_invites: {
        Row: AccountInvite
        Insert: AccountInviteInsert
        Update: Partial<AccountInviteInsert>
        Relationships: []
      }
      api_keys: {
        Row: ApiKey
        Insert: ApiKeyInsert
        Update: ApiKeyUpdate
        Relationships: []
      }
      wood_objects: {
        Row: WoodObject
        Insert: WoodObjectInsert
        Update: WoodObjectUpdate
        Relationships: []
      }
      object_photos: {
        Row: ObjectPhoto
        Insert: ObjectPhotoInsert
        Update: ObjectPhotoUpdate
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      create_account_for_user: { Args: Record<never, never>; Returns: string }
      claim_account_invite: { Args: { invite_id: string }; Returns: { success?: boolean; error?: string; account_id?: string } }
    }
    Enums: { [_ in never]: never }
  }
}
