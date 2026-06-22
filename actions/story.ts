'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getOrCreateAccount } from '@/lib/supabase/account'

export type StoryData = {
  public_title?: string | null
  public_story?: string | null
  public_notes?: string | null
  public_care?: string | null
}

export async function saveStory(
  objectId: string,
  data: StoryData,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const account = await getOrCreateAccount()

  const { error } = await supabase
    .from('wood_objects')
    .update({
      public_title: data.public_title?.trim() || null,
      public_story: data.public_story?.trim() || null,
      public_notes: data.public_notes?.trim() || null,
      public_care: data.public_care?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', objectId)
    .eq('account_id', account.id)

  if (error) return { error: error.message }

  revalidatePath(`/objects/${objectId}`)
  revalidatePath(`/objects/${objectId}/story`)
  return {}
}

export async function publishObject(objectId: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const account = await getOrCreateAccount()

  const { error } = await supabase
    .from('wood_objects')
    .update({ is_published: true, updated_at: new Date().toISOString() })
    .eq('id', objectId)
    .eq('account_id', account.id)

  if (error) return { error: error.message }

  revalidatePath(`/objects/${objectId}`)
  revalidatePath(`/p/`, 'layout')
  revalidatePath('/maker')
  return {}
}

export async function unpublishObject(objectId: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const account = await getOrCreateAccount()

  const { error } = await supabase
    .from('wood_objects')
    .update({ is_published: false, updated_at: new Date().toISOString() })
    .eq('id', objectId)
    .eq('account_id', account.id)

  if (error) return { error: error.message }

  revalidatePath(`/objects/${objectId}`)
  revalidatePath(`/p/`, 'layout')
  return {}
}
