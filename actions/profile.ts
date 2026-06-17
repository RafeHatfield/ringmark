'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getOrCreateAccount } from '@/lib/supabase/account'

export async function saveProfile(formData: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const account = await getOrCreateAccount()

  const display_name = (formData.get('display_name') as string)?.trim() || null
  const workshop_name = (formData.get('workshop_name') as string)?.trim() || null
  const bio = (formData.get('bio') as string)?.trim() || null
  const website_url = (formData.get('website_url') as string)?.trim() || null
  const avatar_storage_path = formData.get('avatar_storage_path') as string | null

  await supabase
    .from('accounts')
    .update({
      display_name,
      workshop_name,
      bio,
      website_url,
      ...(avatar_storage_path !== null && { avatar_storage_path: avatar_storage_path || null }),
    })
    .eq('id', account.id)

  revalidatePath('/profile')
  revalidatePath('/workshop')
}
