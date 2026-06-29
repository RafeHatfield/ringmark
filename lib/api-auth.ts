/**
 * API request authentication for REST API v1 routes.
 *
 * authenticateApiRequest() is the single entry point: it verifies the
 * Bearer token and returns the account the key belongs to. Two modes:
 *
 * Primary — DB hash lookup:
 *   SHA-256 of the provided key is compared against api_keys.key_hash.
 *   Returns the account scoped to that key's account_id.
 *
 * Fallback — env var (RINGMARK_API_KEY):
 *   Timing-safe comparison against the env var, returning the first
 *   account in the DB. This path exists only to survive the deployment
 *   window between the api_keys migration and the DB key being confirmed
 *   working. Remove RINGMARK_API_KEY from the environment after step 7
 *   (MCP endpoint migration) to disable this fallback.
 *
 * Timing note: DB lookup timing is variable (index hit vs. miss),
 * introducing a minor timing oracle vs. the previous timingSafeEqual
 * approach. Network jitter dominates at this scale; accepted trade-off.
 */

import { createHash, timingSafeEqual } from 'crypto'
import type { ServiceClient } from '@/lib/supabase/service'

type Account = { id: string; default_prefix: string }
type AuthResult =
  | { account: Account; error: null }
  | { account: null; error: Response }

const UNAUTHORIZED = (): AuthResult => ({
  account: null,
  error: Response.json({ error: 'Unauthorized' }, { status: 401 }),
})

export async function authenticateApiRequest(
  request: Request,
  db: ServiceClient,
): Promise<AuthResult> {
  const authHeader = request.headers.get('Authorization')

  if (!authHeader?.startsWith('Bearer ')) return UNAUTHORIZED()

  const providedKey = authHeader.slice('Bearer '.length)
  if (!providedKey) return UNAUTHORIZED()

  // ── Primary: DB hash lookup ───────────────────────────────────────────────

  const keyHash = createHash('sha256').update(providedKey).digest('hex')

  const { data: keyRow } = await db
    .from('api_keys')
    .select('account_id')
    .eq('key_hash', keyHash)
    .is('revoked_at', null)
    .maybeSingle()

  if (keyRow) {
    const { data: account } = await db
      .from('accounts')
      .select('id, default_prefix')
      .eq('id', keyRow.account_id)
      .maybeSingle()

    if (account) {
      // Fire-and-forget: don't block the response on this update
      db.from('api_keys')
        .update({ last_used_at: new Date().toISOString() })
        .eq('key_hash', keyHash)
        .then(() => {}, () => {})

      return { account, error: null }
    }
  }

  // ── Fallback: env var (remove after DB key confirmed in production) ────────

  const expectedKey = process.env.RINGMARK_API_KEY
  if (expectedKey) {
    let match = false
    try {
      const expected = Buffer.from(expectedKey, 'utf-8')
      const provided = Buffer.from(providedKey, 'utf-8')
      if (expected.length === provided.length) {
        match = timingSafeEqual(expected, provided)
      } else {
        timingSafeEqual(expected, expected) // constant time, discard result
      }
    } catch { match = false }

    if (match) {
      const { data: account } = await db
        .from('accounts')
        .select('id, default_prefix')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (account) return { account, error: null }
    }
  }

  return UNAUTHORIZED()
}
