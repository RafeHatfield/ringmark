/**
 * API request authentication for REST API v1 routes and the remote MCP endpoint.
 *
 * authenticateApiRequest() is the single entry point. It verifies the Bearer
 * token and returns the account it is scoped to. Two credential types:
 *
 * 1. Account API key — SHA-256 of the presented key is matched against
 *    api_keys.key_hash. Used by the local stdio MCP server, scripts and CI.
 *
 * 2. OAuth 2.1 access token — a JWT issued by Supabase Auth's OAuth server,
 *    verified against the project JWKS. Used by claude.ai and any other MCP
 *    client that goes through the OAuth flow. The token's subject is a real
 *    user, so the account comes from account_members.
 *
 * The two are told apart by shape: a JWT has three dot-separated segments and
 * a decodable header. Anything else is treated as an opaque API key.
 *
 * Audience: OAuth tokens MUST be audience-bound to this resource server
 * (RFC 8707 / MCP authorization spec). A token minted for some other resource
 * is rejected even if its signature is valid — that is the whole point of
 * resource indicators, and skipping the check would let a token issued for
 * another service be replayed here.
 *
 * There is deliberately no environment-variable fallback. An earlier version
 * accepted a shared RINGMARK_API_KEY and resolved it to "the first account in
 * the database", which silently grants one tenant's data to whoever holds the
 * shared secret. That key now lives in api_keys like any other.
 */

import { createHash } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import type { ServiceClient } from '@/lib/supabase/service'
import { mcpResourceUrl, publicOrigin } from '@/lib/mcp-auth'

type Account = { id: string; default_prefix: string }
type AuthResult =
  | { account: Account; error: null }
  | { account: null; error: Response }

const UNAUTHORIZED = (): AuthResult => ({
  account: null,
  error: Response.json({ error: 'Unauthorized' }, { status: 401 }),
})

/** Three base64url segments — good enough to route between credential types. */
function looksLikeJwt(token: string): boolean {
  const parts = token.split('.')
  return parts.length === 3 && parts.every(p => p.length > 0) && token.startsWith('ey')
}

export async function authenticateApiRequest(
  request: Request,
  db: ServiceClient,
): Promise<AuthResult> {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return UNAUTHORIZED()

  const providedKey = authHeader.slice('Bearer '.length).trim()
  if (!providedKey) return UNAUTHORIZED()

  return looksLikeJwt(providedKey)
    ? authenticateOAuthToken(providedKey, db, request)
    : authenticateApiKey(providedKey, db)
}

// ── API key ───────────────────────────────────────────────────────────────────

async function authenticateApiKey(providedKey: string, db: ServiceClient): Promise<AuthResult> {
  const keyHash = createHash('sha256').update(providedKey).digest('hex')

  const { data: keyRow } = await db
    .from('api_keys')
    .select('account_id')
    .eq('key_hash', keyHash)
    .is('revoked_at', null)
    .maybeSingle()

  if (!keyRow) return UNAUTHORIZED()

  const { data: account } = await db
    .from('accounts')
    .select('id, default_prefix')
    .eq('id', keyRow.account_id)
    .maybeSingle()

  if (!account) return UNAUTHORIZED()

  // Fire-and-forget: don't block the response on this update
  db.from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('key_hash', keyHash)
    .then(() => {}, () => {})

  return { account, error: null }
}

// ── OAuth 2.1 access token ────────────────────────────────────────────────────

/**
 * Audiences this resource server will accept.
 *
 * MCP clients bind tokens to the canonical MCP resource URL. Ringmark's REST
 * API is the same protected resource behind a different path — MCP tool
 * handlers forward the caller's token to /api/v1 — so the origin is accepted
 * as well. Both are self-referential: neither can name another service.
 */
function acceptableAudiences(request: Request): string[] {
  return [mcpResourceUrl(request), publicOrigin(request)]
}

function audienceMatches(aud: unknown, accepted: string[]): boolean {
  const claimed = Array.isArray(aud) ? aud : typeof aud === 'string' ? [aud] : []
  return claimed.some(a => accepted.includes(a))
}

async function authenticateOAuthToken(
  token: string,
  db: ServiceClient,
  request: Request,
): Promise<AuthResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return UNAUTHORIZED()

  // Verifies signature and expiry against the project JWKS.
  const verifier = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  let claims: Record<string, unknown>
  try {
    const { data, error } = await verifier.auth.getClaims(token)
    if (error || !data?.claims) return UNAUTHORIZED()
    claims = data.claims as unknown as Record<string, unknown>
  } catch {
    return UNAUTHORIZED()
  }

  if (!audienceMatches(claims.aud, acceptableAudiences(request))) {
    return UNAUTHORIZED()
  }

  const userId = typeof claims.sub === 'string' ? claims.sub : null
  if (!userId) return UNAUTHORIZED()

  const account = await accountForUser(userId, db)
  return account ? { account, error: null } : UNAUTHORIZED()
}

/**
 * Resolves the account an authenticated user acts on.
 *
 * Owners win over plain members, then oldest membership, so the result is
 * deterministic for a user who belongs to more than one account.
 */
async function accountForUser(userId: string, db: ServiceClient): Promise<Account | null> {
  const { data: memberships } = await db
    .from('account_members')
    .select('account_id, role, joined_at')
    .eq('user_id', userId)
    .order('joined_at', { ascending: true })

  if (!memberships?.length) return null

  const chosen = memberships.find(m => m.role === 'owner') ?? memberships[0]

  const { data: account } = await db
    .from('accounts')
    .select('id, default_prefix')
    .eq('id', chosen.account_id)
    .maybeSingle()

  return account ?? null
}
