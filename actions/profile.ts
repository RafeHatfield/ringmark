'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getOrCreateAccount } from '@/lib/supabase/account'

export async function saveProfile(formData: FormData): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const account = await getOrCreateAccount()

  const display_name = (formData.get('display_name') as string)?.trim() || null
  const workshop_name = (formData.get('workshop_name') as string)?.trim() || null
  const bio = (formData.get('bio') as string)?.trim() || null
  const website_url = (formData.get('website_url') as string)?.trim() || null
  const avatar_storage_path = formData.get('avatar_storage_path') as string | null
  const rawHandle = (formData.get('handle') as string)?.trim().toLowerCase() || null
  // Only save handle if it passes format validation; silently ignore otherwise
  const handle = rawHandle && /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(rawHandle) && rawHandle.length >= 2
    ? rawHandle
    : null

  await supabase
    .from('accounts')
    .update({
      display_name,
      workshop_name,
      bio,
      website_url,
      ...(avatar_storage_path !== null && { avatar_storage_path: avatar_storage_path || null }),
      ...(handle !== null && { handle }),
    })
    .eq('id', account.id)

  revalidatePath('/profile')
  revalidatePath('/workshop')
  revalidatePath('/maker')
  if (handle) revalidatePath(`/${handle}/maker`)
}
