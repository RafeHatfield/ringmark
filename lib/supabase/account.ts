import { createClient } from '@/lib/supabase/server'
import type { Account } from '@/lib/types'

export async function getOrCreateAccount(): Promise<Account> {
  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) throw new Error('Not authenticated')

  const { data: existing } = await supabase
    .from('accounts')
    .select('*')
    .eq('owner_user_id', user.id)
    .single()

  if (existing) return existing as Account

  const { data: created, error: insertError } = await supabase
    .from('accounts')
    .insert({
      owner_user_id: user.id,
      name: 'My Workshop',
      default_prefix: 'RH',
    })
    .select()
    .single()

  if (insertError || !created) {
    throw new Error(insertError?.message ?? 'Failed to create account')
  }

  return created as Account
}
