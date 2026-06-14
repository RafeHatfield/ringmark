import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './types'

// Omits visually ambiguous characters (0, O, I, l, 1) for readability
const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
const SLUG_LENGTH = 8

function randomSlug(): string {
  const bytes = new Uint8Array(SLUG_LENGTH)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => CHARSET[b % CHARSET.length])
    .join('')
}

export async function generateSlug(supabase: SupabaseClient<Database>): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const slug = randomSlug()
    const { data } = await supabase
      .from('wood_objects')
      .select('id')
      .eq('public_slug', slug)
      .maybeSingle()
    if (!data) return slug
  }
  throw new Error('Failed to generate unique slug after 10 attempts')
}
