/**
 * OAuth 2.1 resource server surfaces.
 *
 * Ringmark is the *resource server* in the MCP authorization flow; Supabase
 * Auth is the authorization server. These tests cover the parts we own, which
 * are the parts a client needs in order to discover where to get a token:
 *
 *   1. A 401 from /api/mcp carries a WWW-Authenticate challenge naming the
 *      metadata document (RFC 9728 §5.1)
 *   2. That document exists, is public, and names both the canonical resource
 *      identifier and the authorization server
 *   3. The consent screen is auth-gated and survives the login round trip
 *
 * Break any one of these and an MCP client cannot start the OAuth flow at all —
 * it gets a 401 with nowhere to go.
 *
 * Token issuance itself is Supabase's job and is not exercised here.
 */

import { test, expect } from '@playwright/test'
import { TEST_EMAIL, TEST_PASSWORD } from './helpers/supabase-admin'

const BASE = 'http://localhost:3000'
const PRM_PATH = '/.well-known/oauth-protected-resource'

// ── Discovery chain ───────────────────────────────────────────────────────────

test('401 from /api/mcp points at the protected resource metadata', async ({ request }) => {
  const r = await request.post(`${BASE}/api/mcp`, {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    data: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
  })
  expect(r.status()).toBe(401)

  const challenge = r.headers()['www-authenticate'] ?? ''
  expect(challenge).toMatch(/^Bearer /)
  const match = challenge.match(/resource_metadata="([^"]+)"/)
  expect(match, `no resource_metadata in challenge: ${challenge}`).toBeTruthy()
  expect(match![1]).toContain(PRM_PATH)
})

test('protected resource metadata is public and well-formed', async ({ request }) => {
  const r = await request.get(`${BASE}${PRM_PATH}`)
  expect(r.status()).toBe(200)

  const body = await r.json()
  // RFC 9728: resource identifier plus the issuers that can mint tokens for it
  expect(body.resource).toBe(`${BASE}/api/mcp`)
  expect(Array.isArray(body.authorization_servers)).toBe(true)
  expect(body.authorization_servers.length).toBeGreaterThan(0)
  expect(body.authorization_servers[0]).toMatch(/^https:\/\/.+\/auth\/v1$/)
})

test('metadata endpoint requires no credentials at all', async ({ request }) => {
  // Sending a deliberately bad token must not change the response — discovery
  // happens before the client has any token.
  const r = await request.get(`${BASE}${PRM_PATH}`, {
    headers: { Authorization: 'Bearer garbage' },
  })
  expect(r.status()).toBe(200)
})

test('the resource identifier matches what the 401 advertises', async ({ request }) => {
  // These two drifting apart is the classic audience-validation bug: the client
  // requests a token for one resource and presents it to another.
  const challenge = (
    await request.post(`${BASE}/api/mcp`, {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      data: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    })
  ).headers()['www-authenticate']

  const metadataUrl = challenge.match(/resource_metadata="([^"]+)"/)![1]
  const metadata = await (await request.get(metadataUrl)).json()

  expect(metadata.resource).toBe(`${BASE}/api/mcp`)
})

// ── Consent screen ────────────────────────────────────────────────────────────

test('consent screen is auth-gated and preserves authorization_id through login', async ({ request }) => {
  const r = await request.get(`${BASE}/oauth/consent?authorization_id=test-authz-123`, {
    maxRedirects: 0,
  })
  expect(r.status()).toBe(307)

  const location = r.headers()['location'] ?? ''
  expect(location).toContain('/login')

  // Losing authorization_id here strands the user on /workshop with no way back
  // into the flow.
  const next = new URL(location, BASE).searchParams.get('next')
  expect(next).toBe('/oauth/consent?authorization_id=test-authz-123')
})

test('consent screen without an authorization_id does not error', async ({ page }) => {
  // Signs in inline rather than reusing the shared storageState: other specs in
  // this suite revoke that session, and this test only needs to be authenticated
  // enough to get past middleware.
  await page.goto('/login')
  await page.fill('#email', TEST_EMAIL)
  await page.fill('#password', TEST_PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL('/workshop')

  await page.goto(`${BASE}/oauth/consent`)
  await expect(page.getByText('Nothing to approve')).toBeVisible()
})
