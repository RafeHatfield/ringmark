import { createClient } from '@/lib/supabase/server'
import type { Account } from '@/lib/types'

export async function getOrCreateAccount(): Promise<Account> {
  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) throw new Error('Not authenticated')

  // Look up via membership table — works for both owners and invited members
  const { data: membership } = await supabase
    .from('account_members')
    .select('account_id')
    .eq('user_id', user.id)
    .single()

  if (membership) {
    const { data: account } = await supabase
      .from('accounts')
      .select('*')
      .eq('id', membership.account_id)
      .single()
    if (account) return account as Account
  }

  // No membership found — create a new account and add as first member atomically
  const { data: accountId, error: rpcError } = await supabase.rpc('create_account_for_user')
  if (rpcError || !accountId) {
    throw new Error(rpcError?.message ?? 'Failed to create account')
  }

  const { data: account } = await supabase
    .from('accounts')
    .select('*')
    .eq('id', accountId)
    .single()

  if (!account) throw new Error('Account not found after creation')
  return account as Account
}
