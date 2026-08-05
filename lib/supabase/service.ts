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

// There is deliberately no getAccount(db) helper here. The previous one
// returned "the oldest account in the database", which is only ever correct
// when there is exactly one — and there is no longer exactly one. Callers must
// derive the account from the authenticated credential instead:
// authenticateApiRequest() in lib/api-auth.ts for API routes,
// getOrCreateAccount() in lib/supabase/account.ts for session-backed code.
