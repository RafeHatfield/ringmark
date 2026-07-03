'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getOrCreateAccount } from '@/lib/supabase/account'
import { generateSlug } from '@/lib/slug-gen'
import type { ObjectType, ObjectStatus, SpeciesConfidence, WoodObjectUpdate } from '@/lib/types'
import { computeRootId } from '@/lib/lineage-utils'

export type CreateObjectData = {
  workshop_id: string
  object_type: ObjectType
  parent_id?: string | null
  title?: string | null
  species?: string | null
  species_confidence?: SpeciesConfidence | null
  status?: ObjectStatus | null
  private_notes?: string | null
  public_story?: string | null
}

export async function createObject(
  data: CreateObjectData
): Promise<{ error?: string; id?: string }> {
  const supabase = await createClient()
  const account = await getOrCreateAccount()

  const workshopIdLower = data.workshop_id.toLowerCase().trim()
  if (!workshopIdLower) return { error: 'Workshop ID is required.' }

  const { data: existing } = await supabase
    .from('wood_objects')
    .select('id')
    .eq('account_id', account.id)
    .eq('workshop_id_lower', workshopIdLower)
    .maybeSingle()

  if (existing) {
    return { error: `"${data.workshop_id.toUpperCase()}" is already taken.` }
  }

  const public_slug = await generateSlug(supabase)

  let root_id: string | null = null
  let parentSpecies: string | null = null
  if (data.parent_id) {
    const { data: parent } = await supabase
      .from('wood_objects')
      .select('root_id, species')
      .eq('id', data.parent_id)
      .single()
    root_id = parent?.root_id ?? null
    parentSpecies = parent?.species ?? null
  }

  const { data: created, error } = await supabase
    .from('wood_objects')
    .insert({
      account_id: account.id,
      workshop_id: data.workshop_id.toUpperCase().trim(),
      workshop_id_lower: workshopIdLower,
      public_slug,
      object_type: data.object_type,
      parent_id: data.parent_id ?? null,
      root_id,
      title: data.title?.trim() || null,
      species: data.species?.trim() || parentSpecies,
      species_confidence: !data.species?.trim() && data.parent_id
        ? null
        : data.species_confidence || null,
      status: data.status || null,
      private_notes: data.private_notes?.trim() || null,
      public_story: data.public_story?.trim() || null,
    })
    .select('id')
    .single()

  if (error || !created) return { error: error?.message ?? 'Failed to create object.' }

  // Source objects (no parent) use their own id as root_id
  if (!data.parent_id) {
    await supabase
      .from('wood_objects')
      .update({ root_id: created.id })
      .eq('id', created.id)
  }

  revalidatePath('/')
  return { id: created.id }
}

export type UpdateObjectData = Partial<{
  workshop_id: string
  object_type: ObjectType
  status: ObjectStatus | null
  parent_id: string | null
  title: string | null
  species: string | null
  species_confidence: string | null
  lineage_confidence: string | null
  dimensions_text: string | null
  finish: string | null
  location_text: string | null
  private_notes: string | null
  public_notes: string | null
  public_title: string | null
  public_story: string | null
  public_care: string | null
  is_published: boolean
}>

export async function updateObject(
  id: string,
  data: UpdateObjectData
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const account = await getOrCreateAccount()

  const { data: existing } = await supabase
    .from('wood_objects')
    .select('id, workshop_id_lower')
    .eq('id', id)
    .eq('account_id', account.id)
    .single()

  if (!existing) return { error: 'Object not found.' }

  const payload: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(data)) {
    if (key === 'parent_id') continue  // handled below
    if (key === 'workshop_id' && value) {
      const newLower = (value as string).toLowerCase().trim()
      if (newLower !== existing.workshop_id_lower) {
        const { data: conflict } = await supabase
          .from('wood_objects')
          .select('id')
          .eq('account_id', account.id)
          .eq('workshop_id_lower', newLower)
          .maybeSingle()
        if (conflict) {
          return { error: `"${(value as string).toUpperCase()}" is already taken.` }
        }
      }
      payload.workshop_id = (value as string).toUpperCase().trim()
      payload.workshop_id_lower = newLower
    } else {
      payload[key] = value === '' ? null : value
    }
  }

  // Re-parenting: update parent_id and derive new root_id
  if ('parent_id' in data) {
    const newParentId = data.parent_id ?? null
    payload.parent_id = newParentId

    let newParentRootId: string | null = null
    if (newParentId) {
      const { data: newParent } = await supabase
        .from('wood_objects')
        .select('root_id')
        .eq('id', newParentId)
        .single()
      newParentRootId = newParent?.root_id ?? null
    }
    payload.root_id = computeRootId(newParentId, newParentRootId, id)
  }

  payload.updated_at = new Date().toISOString()

  const { error } = await supabase
    .from('wood_objects')
    .update(payload as WoodObjectUpdate)
    .eq('id', id)
    .eq('account_id', account.id)

  if (error) return { error: error.message }

  revalidatePath(`/objects/${id}`)
  revalidatePath('/')
  return {}
}

export async function updateStatus(
  id: string,
  status: ObjectStatus | null
): Promise<{ error?: string }> {
  return updateObject(id, { status })
}

export async function deleteObject(id: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const account = await getOrCreateAccount()

  const { error } = await supabase
    .from('wood_objects')
    .delete()
    .eq('id', id)
    .eq('account_id', account.id)

  if (error) return { error: error.message }

  revalidatePath('/')
  return {}
}

export async function checkWorkshopId(
  workshopId: string,
  excludeId?: string
): Promise<{ available: boolean }> {
  const supabase = await createClient()
  const account = await getOrCreateAccount()

  let query = supabase
    .from('wood_objects')
    .select('id')
    .eq('account_id', account.id)
    .eq('workshop_id_lower', workshopId.toLowerCase().trim())

  if (excludeId) query = query.neq('id', excludeId)

  const { data } = await query.maybeSingle()
  return { available: !data }
}

export async function searchObjects(
  query: string
): Promise<{ id: string; workshop_id: string; object_type: ObjectType }[]> {
  if (!query.trim()) return []
  const supabase = await createClient()
  const account = await getOrCreateAccount()

  const { data } = await supabase
    .from('wood_objects')
    .select('id, workshop_id, object_type')
    .eq('account_id', account.id)
    .ilike('workshop_id_lower', `${query.toLowerCase().trim()}%`)
    .order('workshop_id')
    .limit(8)

  return (data ?? []) as { id: string; workshop_id: string; object_type: ObjectType }[]
}
