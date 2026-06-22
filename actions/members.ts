'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getOrCreateAccount } from '@/lib/supabase/account'

export async function createInvite(): Promise<void> {
  const supabase = await createClient()
  const account = await getOrCreateAccount()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    console.error('[createInvite] Not authenticated')
    return
  }

  const { data, error } = await supabase
    .from('account_invites')
    .insert({ account_id: account.id, created_by: user.id })
    .select('id')
    .single()

  if (error || !data) {
    console.error('[createInvite]', error?.message ?? 'Failed to create invite')
    return
  }

  redirect(`/settings?invite=${data.id}`)
}

export async function claimInvite(
  token: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('claim_account_invite', {
    invite_id: token,
  })

  if (error) return { success: false, error: error.message }

  const result = data as { success?: boolean; error?: string }
  if (result?.error) return { success: false, error: result.error }
  return { success: true }
}
