import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './types'

export async function suggestRootId(
  supabase: SupabaseClient<Database>,
  accountId: string,
  prefix: string
): Promise<string> {
  const { data } = await supabase
    .from('wood_objects')
    .select('workshop_id')
    .eq('account_id', accountId)
    .is('parent_id', null)

  if (!data || data.length === 0) return `${prefix}1`

  const pattern = new RegExp(`^${escapeRegex(prefix)}(\\d+)$`, 'i')
  let max = 0
  for (const obj of data) {
    const match = obj.workshop_id.match(pattern)
    if (match) {
      const n = parseInt(match[1], 10)
      if (n > max) max = n
    }
  }
  return `${prefix}${max + 1}`
}

export async function suggestDescendantId(
  supabase: SupabaseClient<Database>,
  accountId: string,
  rootId: string,
  rootWorkshopId: string
): Promise<string> {
  const { data } = await supabase
    .from('wood_objects')
    .select('workshop_id')
    .eq('account_id', accountId)
    .eq('root_id', rootId)

  if (!data || data.length === 0) return `${rootWorkshopId}-1`

  const pattern = new RegExp(`^${escapeRegex(rootWorkshopId)}-(\\d+)$`, 'i')
  let max = 0
  for (const obj of data) {
    const match = obj.workshop_id.match(pattern)
    if (match) {
      const n = parseInt(match[1], 10)
      if (n > max) max = n
    }
  }
  return `${rootWorkshopId}-${max + 1}`
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
