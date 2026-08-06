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
  /** Optional asking price in cents. Never selected in public/anon queries. */
  price_cents: number | null
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
  price_cents?: number | null
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
  /** Set when the photo is soft-deleted. Null means live. */
  deleted_at: string | null
  deleted_by: string | null
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
  deleted_at?: string | null
  deleted_by?: string | null
}

export type ObjectPhotoUpdate = Partial<ObjectPhotoInsert>

export type AccountMember = {
  account_id: string
  user_id: string
  role: 'owner' | 'member'
  joined_at: string
}

// ── Market Mode ───────────────────────────────────────────────────────────────

export type MarketEventStatus = 'planning' | 'active' | 'completed' | 'cancelled'

export type MarketEvent = {
  id: string
  account_id: string
  name: string
  /** Nullable: a market can be planned before its date is fixed. */
  event_date: string | null
  location_text: string | null
  notes: string | null
  status: MarketEventStatus
  created_at: string
  updated_at: string
}

export type MarketEventInsert = {
  account_id: string
  name: string
  id?: string
  event_date?: string | null
  location_text?: string | null
  notes?: string | null
  status?: MarketEventStatus
  created_at?: string
  updated_at?: string
}

export type MarketEventUpdate = Partial<MarketEventInsert>

/**
 * One appearance of one piece at one event. Many-to-many by design: the same
 * piece can go to several markets before it sells, each with its own asking
 * price and sold state.
 */
export type MarketEventItem = {
  id: string
  account_id: string
  market_event_id: string
  object_id: string
  asking_price_cents: number | null
  sold: boolean
  sold_price_cents: number | null
  sold_at: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

export type MarketEventItemInsert = {
  account_id: string
  market_event_id: string
  object_id: string
  id?: string
  asking_price_cents?: number | null
  sold?: boolean
  sold_price_cents?: number | null
  sold_at?: string | null
  sort_order?: number
  created_at?: string
  updated_at?: string
}

export type MarketEventItemUpdate = Partial<MarketEventItemInsert>

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
        Relationships: [
          {
            foreignKeyName: 'object_photos_object_id_fkey'
            columns: ['object_id']
            isOneToOne: false
            referencedRelation: 'wood_objects'
            referencedColumns: ['id']
          }
        ]
      }
      market_events: {
        Row: MarketEvent
        Insert: MarketEventInsert
        Update: MarketEventUpdate
        Relationships: [
          {
            foreignKeyName: 'market_events_account_id_fkey'
            columns: ['account_id']
            isOneToOne: false
            referencedRelation: 'accounts'
            referencedColumns: ['id']
          }
        ]
      }
      market_event_items: {
        Row: MarketEventItem
        Insert: MarketEventItemInsert
        Update: MarketEventItemUpdate
        Relationships: [
          {
            foreignKeyName: 'market_event_items_market_event_id_fkey'
            columns: ['market_event_id']
            isOneToOne: false
            referencedRelation: 'market_events'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'market_event_items_object_id_fkey'
            columns: ['object_id']
            isOneToOne: false
            referencedRelation: 'wood_objects'
            referencedColumns: ['id']
          }
        ]
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
