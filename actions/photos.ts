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
    .select('id, public_slug')
    .eq('id', objectId)
    .eq('account_id', account.id)
    .single()

  if (!object) return { error: 'Object not found.' }

  // Deliberately NOT filtered by deleted_at: sort_order must stay monotonic
  // across soft-deleted rows too, or restoring a photo collides with whatever
  // took its old slot.
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
  if (object.public_slug) revalidatePath(`/p/${object.public_slug}`)
  return { id: created.id }
}

/**
 * Soft-deletes a photo. The storage file is retained so the delete stays
 * reversible via restorePhoto(); the bucket is private and every public read
 * mints a signed URL on demand, so a soft-deleted photo is unreachable once
 * it drops out of the read paths.
 */
export async function deletePhoto(photoId: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const account = await getOrCreateAccount()

  const { data: photo } = await supabase
    .from('object_photos')
    .select('id, object_id, wood_objects(public_slug)')
    .eq('id', photoId)
    .eq('account_id', account.id)
    .is('deleted_at', null)
    .single()

  if (!photo) return { error: 'Photo not found.' }

  const { data: { user } } = await supabase.auth.getUser()

  const { error } = await supabase
    .from('object_photos')
    .update({ deleted_at: new Date().toISOString(), deleted_by: user?.id ?? null })
    .eq('id', photoId)
    .eq('account_id', account.id)

  if (error) return { error: error.message }

  revalidatePath(`/objects/${photo.object_id}`)
  if (photo.wood_objects?.public_slug) revalidatePath(`/p/${photo.wood_objects.public_slug}`)
  return {}
}

/** Restores a soft-deleted photo, putting it back in its original sort position. */
export async function restorePhoto(photoId: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const account = await getOrCreateAccount()

  const { data: photo } = await supabase
    .from('object_photos')
    .select('id, object_id, wood_objects(public_slug)')
    .eq('id', photoId)
    .eq('account_id', account.id)
    .not('deleted_at', 'is', null)
    .single()

  if (!photo) return { error: 'Deleted photo not found.' }

  const { error } = await supabase
    .from('object_photos')
    .update({ deleted_at: null, deleted_by: null })
    .eq('id', photoId)
    .eq('account_id', account.id)

  if (error) return { error: error.message }

  revalidatePath(`/objects/${photo.object_id}`)
  if (photo.wood_objects?.public_slug) revalidatePath(`/p/${photo.wood_objects.public_slug}`)
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
    .select('id, object_id, wood_objects(public_slug)')
    .eq('id', photoId)
    .eq('account_id', account.id)
    .is('deleted_at', null)
    .single()

  if (!photo) return { error: 'Photo not found.' }

  const { error } = await supabase
    .from('object_photos')
    .update({ caption, updated_at: new Date().toISOString() })
    .eq('id', photoId)

  if (error) return { error: error.message }

  revalidatePath(`/objects/${photo.object_id}`)
  if (photo.wood_objects?.public_slug) revalidatePath(`/p/${photo.wood_objects.public_slug}`)
  return {}
}

export async function togglePhotoVisibility(photoId: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const account = await getOrCreateAccount()

  const { data: photo } = await supabase
    .from('object_photos')
    .select('id, is_public, object_id, wood_objects(public_slug)')
    .eq('id', photoId)
    .eq('account_id', account.id)
    .is('deleted_at', null)
    .single()

  if (!photo) return { error: 'Photo not found.' }

  const { error } = await supabase
    .from('object_photos')
    .update({ is_public: !photo.is_public, updated_at: new Date().toISOString() })
    .eq('id', photoId)

  if (error) return { error: error.message }

  revalidatePath(`/objects/${photo.object_id}`)
  if (photo.wood_objects?.public_slug) revalidatePath(`/p/${photo.wood_objects.public_slug}`)
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
    .select('id, object_id, sort_order, wood_objects(public_slug)')
    .eq('id', photoId)
    .eq('account_id', account.id)
    .is('deleted_at', null)
    .single()

  if (!photo) return { error: 'Photo not found.' }

  const { data: all } = await supabase
    .from('object_photos')
    .select('id, sort_order')
    .eq('object_id', photo.object_id)
    .eq('account_id', account.id)
    .is('deleted_at', null)

  if (!all) return {}

  const pair = getSwapPair(all, photoId, direction)
  if (!pair) return {}

  const [a, b] = pair
  await Promise.all([
    supabase.from('object_photos').update({ sort_order: b.sort_order }).eq('id', a.id),
    supabase.from('object_photos').update({ sort_order: a.sort_order }).eq('id', b.id),
  ])

  revalidatePath(`/objects/${photo.object_id}`)
  if (photo.wood_objects?.public_slug) revalidatePath(`/p/${photo.wood_objects.public_slug}`)
  return {}
}
