'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getOrCreateAccount } from '@/lib/supabase/account'
import { getSwapPair } from '@/lib/photo-utils'

export async function createPhotoRecord(
  objectId: string,
  storagePath: string,
  caption: string | null,
): Promise<{ error?: string; id?: string }> {
  const supabase = await createClient()
  const account = await getOrCreateAccount()

  // Verify object ownership
  const { data: object } = await supabase
    .from('wood_objects')
    .select('id')
    .eq('id', objectId)
    .eq('account_id', account.id)
    .single()

  if (!object) return { error: 'Object not found.' }

  const { data: last } = await supabase
    .from('object_photos')
    .select('sort_order')
    .eq('object_id', objectId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextOrder = (last?.sort_order ?? -1) + 1

  const { data: created, error } = await supabase
    .from('object_photos')
    .insert({
      account_id: account.id,
      object_id: objectId,
      storage_path: storagePath,
      caption,
      is_public: true,
      sort_order: nextOrder,
    })
    .select('id')
    .single()

  if (error || !created) return { error: error?.message ?? 'Failed to save photo.' }

  revalidatePath(`/objects/${objectId}`)
  return { id: created.id }
}

export async function deletePhoto(photoId: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const account = await getOrCreateAccount()

  const { data: photo } = await supabase
    .from('object_photos')
    .select('id, storage_path, object_id')
    .eq('id', photoId)
    .eq('account_id', account.id)
    .single()

  if (!photo) return { error: 'Photo not found.' }

  await supabase.storage.from('object-photos').remove([photo.storage_path])

  const { error } = await supabase
    .from('object_photos')
    .delete()
    .eq('id', photoId)

  if (error) return { error: error.message }

  revalidatePath(`/objects/${photo.object_id}`)
  return {}
}

export async function updatePhotoCaption(
  photoId: string,
  caption: string | null,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const account = await getOrCreateAccount()

  const { data: photo } = await supabase
    .from('object_photos')
    .select('id, object_id')
    .eq('id', photoId)
    .eq('account_id', account.id)
    .single()

  if (!photo) return { error: 'Photo not found.' }

  const { error } = await supabase
    .from('object_photos')
    .update({ caption, updated_at: new Date().toISOString() })
    .eq('id', photoId)

  if (error) return { error: error.message }

  revalidatePath(`/objects/${photo.object_id}`)
  return {}
}

export async function togglePhotoVisibility(photoId: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const account = await getOrCreateAccount()

  const { data: photo } = await supabase
    .from('object_photos')
    .select('id, is_public, object_id')
    .eq('id', photoId)
    .eq('account_id', account.id)
    .single()

  if (!photo) return { error: 'Photo not found.' }

  const { error } = await supabase
    .from('object_photos')
    .update({ is_public: !photo.is_public, updated_at: new Date().toISOString() })
    .eq('id', photoId)

  if (error) return { error: error.message }

  revalidatePath(`/objects/${photo.object_id}`)
  return {}
}

export async function movePhoto(
  photoId: string,
  direction: 'up' | 'down',
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const account = await getOrCreateAccount()

  const { data: photo } = await supabase
    .from('object_photos')
    .select('id, object_id, sort_order')
    .eq('id', photoId)
    .eq('account_id', account.id)
    .single()

  if (!photo) return { error: 'Photo not found.' }

  const { data: all } = await supabase
    .from('object_photos')
    .select('id, sort_order')
    .eq('object_id', photo.object_id)
    .eq('account_id', account.id)

  if (!all) return {}

  const pair = getSwapPair(all, photoId, direction)
  if (!pair) return {}

  const [a, b] = pair
  await Promise.all([
    supabase.from('object_photos').update({ sort_order: b.sort_order }).eq('id', a.id),
    supabase.from('object_photos').update({ sort_order: a.sort_order }).eq('id', b.id),
  ])

  revalidatePath(`/objects/${photo.object_id}`)
  return {}
}
