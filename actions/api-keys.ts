'use server'

import { revalidatePath } from 'next/cache'
import { randomBytes, createHash } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { getOrCreateAccount } from '@/lib/supabase/account'

async function requireOwner() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' as const, supabase: null, user: null, account: null }

  const account = await getOrCreateAccount()

  const { data: membership } = await supabase
    .from('account_members')
    .select('role')
    .eq('account_id', account.id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (membership?.role !== 'owner') {
    return { error: 'Only account owners can manage API keys' as const, supabase: null, user: null, account: null }
  }

  return { error: null, supabase, user, account }
}

export async function createApiKey(
  label: string,
): Promise<{ rawKey: string } | { error: string }> {
  const { error, supabase, user, account } = await requireOwner()
  if (error) return { error }

  const rawKey  = 'rmk_' + randomBytes(16).toString('hex')
  const keyHash = createHash('sha256').update(rawKey).digest('hex')

  const { error: insertError } = await supabase!.from('api_keys').insert({
    account_id: account!.id,
    key_hash:   keyHash,
    key_prefix: rawKey.slice(0, 8),
    label:      label.trim(),
    created_by: user!.id,
  })

  if (insertError) return { error: insertError.message }

  revalidatePath('/settings')
  return { rawKey }
}

export async function revokeApiKey(keyId: string): Promise<{ error?: string }> {
  const { error, supabase, account } = await requireOwner()
  if (error) return { error }

  const { error: deleteError } = await supabase!
    .from('api_keys')
    .delete()
    .eq('id', keyId)
    .eq('account_id', account!.id)

  if (deleteError) return { error: deleteError.message }

  revalidatePath('/settings')
  return {}
}
