/**
 * End-to-end OAuth 2.1 verification for the remote MCP server.
 *
 * Runs the exact flow claude.ai runs — dynamic client registration, then an
 * authorization-code + PKCE(S256) exchange with the RFC 8707 `resource`
 * parameter — and then checks the two things that actually gate access:
 *
 *   1. Is the issued token audience-bound to this resource server?
 *   2. Does /api/mcp accept it and list tools?
 *
 * Supabase Auth does not implement RFC 8707 on its own (verified 2026-08-05:
 * `resource` is accepted and ignored, tokens come back with aud
 * "authenticated"). Audience binding therefore depends on the Custom Access
 * Token Hook in supabase/migrations/20260805000001_oauth_audience_hook.sql
 * being both applied AND registered in the dashboard. This script is how you
 * confirm that actually happened — creating the function alone does nothing.
 *
 * Usage:
 *   node --env-file=.env.local scripts/verify-oauth-flow.mjs
 *   node --env-file=.env.local scripts/verify-oauth-flow.mjs http://localhost:3000
 *
 * Requires E2E_TEST_EMAIL / E2E_TEST_PASSWORD (or the e2e defaults) to exist.
 * Exits non-zero on failure so it can gate a release.
 */

import { createHash, randomBytes } from 'crypto'
import { chromium } from '@playwright/test'

const TARGET = (process.argv[2] ?? 'https://ringmark.org').replace(/\/$/, '')
const RESOURCE = `${TARGET}/api/mcp`
const AS = `${process.env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, '')}/auth/v1`
const REDIRECT = 'http://localhost:9876/callback'
const EMAIL = process.env.E2E_TEST_EMAIL ?? 'e2e@ringmark.local'
const PASSWORD = process.env.E2E_TEST_PASSWORD ?? 'RingmarkE2E2026!'

const b64url = b => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
const decodeJwt = t =>
  JSON.parse(Buffer.from(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString())

const problems = []
const ok = m => console.log(`  ✓ ${m}`)
const bad = m => { console.log(`  ✗ ${m}`); problems.push(m) }

console.log(`\nVerifying OAuth flow against ${TARGET}\n`)

// ── Discovery ────────────────────────────────────────────────────────────────
console.log('Discovery')
const challenge401 = await fetch(`${TARGET}/api/mcp`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
  body: '{}',
})
const wwwAuth = challenge401.headers.get('www-authenticate') ?? ''
challenge401.status === 401 ? ok('unauthenticated POST → 401') : bad(`expected 401, got ${challenge401.status}`)
wwwAuth.includes('resource_metadata=')
  ? ok('401 carries resource_metadata challenge')
  : bad(`WWW-Authenticate missing resource_metadata: ${wwwAuth}`)

const prm = await (await fetch(`${TARGET}/.well-known/oauth-protected-resource`)).json()
prm.resource === RESOURCE ? ok(`metadata resource = ${prm.resource}`) : bad(`metadata resource is ${prm.resource}, expected ${RESOURCE}`)

// ── Registration + authorization ─────────────────────────────────────────────
console.log('\nAuthorization')
const reg = await (await fetch(`${AS}/oauth/clients/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    client_name: 'Ringmark OAuth verification',
    redirect_uris: [REDIRECT],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  }),
})).json()
reg.client_id ? ok('dynamic client registration accepted') : bad('DCR failed')

const verifier = b64url(randomBytes(32))
const authUrl = new URL(`${AS}/oauth/authorize`)
Object.entries({
  client_id: reg.client_id,
  redirect_uri: REDIRECT,
  response_type: 'code',
  scope: 'openid email profile offline_access',
  code_challenge: b64url(createHash('sha256').update(verifier).digest()),
  code_challenge_method: 'S256',
  state: randomBytes(8).toString('hex'),
  resource: RESOURCE,
}).forEach(([k, v]) => authUrl.searchParams.set(k, v))

const browser = await chromium.launch()
const page = await (await browser.newContext()).newPage()
let code = null
await page.route('http://localhost:9876/**', async route => {
  code = new URL(route.request().url()).searchParams.get('code')
  await route.fulfill({ status: 200, contentType: 'text/plain', body: 'captured' })
})
await page.goto(authUrl.toString(), { waitUntil: 'domcontentloaded' })
if (page.url().includes('/login')) {
  await page.fill('#email', EMAIL)
  await page.fill('#password', PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForLoadState('networkidle')
}
if (page.url().includes('/oauth/consent')) {
  ok('consent screen rendered')
  await page.getByRole('button', { name: /Allow access/i }).click()
  await page.waitForLoadState('networkidle')
} else {
  ok('already consented (auto-approved)')
}
await page.waitForTimeout(2500)
await browser.close()
code ? ok('authorization code returned') : bad('no authorization code captured')

// ── Token ────────────────────────────────────────────────────────────────────
console.log('\nToken')
const tok = await (await fetch(`${AS}/oauth/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    code: code ?? '',
    redirect_uri: REDIRECT,
    client_id: reg.client_id,
    code_verifier: verifier,
    resource: RESOURCE,
  }),
})).json()
tok.access_token ? ok('token exchange succeeded') : bad(`token exchange failed: ${JSON.stringify(tok)}`)

if (tok.access_token) {
  const claims = decodeJwt(tok.access_token)
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  aud.includes(RESOURCE)
    ? ok(`audience bound to resource (aud = ${JSON.stringify(claims.aud)})`)
    : bad(
        `token is NOT audience-bound — aud = ${JSON.stringify(claims.aud)}. ` +
        'The Custom Access Token Hook is not registered in Authentication → Hooks, ' +
        'or the migration has not been applied.'
      )

  // ── The thing that actually matters ────────────────────────────────────────
  console.log('\nMCP access')
  const res = await fetch(`${TARGET}/api/mcp`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tok.access_token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  })
  const text = await res.text()
  const line = text.split('\n').find(l => l.startsWith('data: '))
  const body = line ? JSON.parse(line.slice(6)) : (() => { try { return JSON.parse(text) } catch { return {} } })()
  const tools = body?.result?.tools ?? []

  res.status === 200 && tools.length
    ? ok(`tools/list returned ${tools.length} tools with an OAuth token`)
    : bad(`tools/list failed (HTTP ${res.status}): ${text.slice(0, 200)}`)

  if (tools.length) {
    const del = tools.find(t => t.name === 'delete_object')
    del && !('force' in (del.inputSchema?.properties ?? {}))
      ? ok('delete_object exposes no force parameter')
      : bad('remote delete_object should not expose force')
  }
}

console.log(
  problems.length
    ? `\nFAILED — ${problems.length} problem(s):\n  - ${problems.join('\n  - ')}\n`
    : '\nAll checks passed.\n'
)
process.exit(problems.length ? 1 : 0)
