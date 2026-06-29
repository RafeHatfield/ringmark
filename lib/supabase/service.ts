import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/types'

/**
 * Creates a Supabase client using the service role key.
 * Bypasses RLS — use only in server-side API routes that perform their own
 * authorization (API key check + account scoping).
 *
 * Never expose this client or its key to the browser.
 */
export function createServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export type ServiceClient = ReturnType<typeof createServiceClient>

/**
 * Resolves the single account for this Ringmark instance.
 * Throws if no account row exists (server misconfiguration).
 */
export async function getAccount(db: ServiceClient) {
  const { data, error } = await db
    .from('accounts')
    .select('id, default_prefix')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error || !data) throw new Error('No account found in database')
  return data
}
