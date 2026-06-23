import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, WoodObject } from './types'

/**
 * All columns returned for a full object response via the REST API.
 * Mirrors the OBJECT_SELECT constant in mcp/index.ts.
 */
export const OBJECT_SELECT =
  'id, workshop_id, workshop_id_lower, object_type, status, title, species, species_confidence, public_slug, public_title, public_story, public_notes, public_care, location_text, private_notes, dimensions_text, finish, is_published, parent_id, root_id, lineage_confidence, account_id, created_at, updated_at' as const

/**
 * Resolve an object by UUID or workshop ID, scoped to the given account.
 *
 * - If `id` looks like a UUID (hex-8-4 prefix), queries by `id` column.
 * - Otherwise, queries by `workshop_id` case-insensitively.
 *
 * Returns null if no matching object is found.
 */
export async function resolveObject(
  id: string,
  accountId: string,
  db: SupabaseClient<Database>
): Promise<WoodObject | null> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id)

  if (isUuid) {
    const { data } = await db
      .from('wood_objects')
      .select(OBJECT_SELECT)
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    return data as WoodObject | null
  }

  const { data } = await db
    .from('wood_objects')
    .select(OBJECT_SELECT)
    .ilike('workshop_id', id)
    .eq('account_id', accountId)
    .maybeSingle()
  return data as WoodObject | null
}
