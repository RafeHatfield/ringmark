/**
 * authenticateApiRequest() tests — step 6 of multi-user plan.
 *
 * The 82 existing API tests confirm the DB-lookup path works end-to-end
 * (the seeded key is in api_keys and all routes now use authenticateApiRequest).
 * This file covers the additional behaviours:
 *
 * - Revoked key → 401
 * - DB key scopes to the correct account (not oldest account)
 * - last_used_at is updated on successful auth
 * - Env var fallback still works (dual-mode: RINGMARK_API_KEY still set)
 */

import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import {
  ensureTestUser,
  getAccountIdForUser,
} from './helpers/supabase-admin'

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

const BASE = 'http://localhost:3000'

// Raw test key — inserted directly and cleaned up in afterAll
const TEST_RAW_KEY = `rmk_testauthrequest${Date.now().toString(16)}`
const TEST_KEY_HASH = createHash('sha256').update(TEST_RAW_KEY).digest('hex')
let testKeyId: string | null = null

test.beforeAll(async () => {
  const userAId = await ensureTestUser()
  const accountAId = await getAccountIdForUser(userAId)
  const admin = adminClient()

  const { data } = await admin.from('api_keys').insert({
    account_id: accountAId,
    key_hash:   TEST_KEY_HASH,
    key_prefix: TEST_RAW_KEY.slice(0, 8),
    label:      'step-6 auth test key',
    created_by: userAId,
  }).select('id').single()

  testKeyId = data?.id ?? null
})

test.afterAll(async () => {
  if (!testKeyId) return
  await adminClient().from('api_keys').delete().eq('id', testKeyId)
})

// ── DB key lookup ─────────────────────────────────────────────────────────────

test('DB key lookup — key in api_keys returns 200 on authenticated endpoint', async ({ request }) => {
  const r = await request.get(`${BASE}/api/v1/objects`, {
    headers: { Authorization: `Bearer ${TEST_RAW_KEY}` },
  })
  expect(r.status()).toBe(200)
  const body = await r.json()
  expect(body).toHaveProperty('data')
})

test('DB key lookup — key scopes to correct account, not oldest account', async ({ request }) => {
  const userAId = await ensureTestUser()
  const accountAId = await getAccountIdForUser(userAId)

  // Create an object under account A using the test key
  const create = await request.post(`${BASE}/api/v1/objects`, {
    headers: {
      Authorization: `Bearer ${TEST_RAW_KEY}`,
      'Content-Type': 'application/json',
    },
    data: { object_type: 'offcut', workshop_id: `AUTHTEST${Date.now()}` },
  })
  expect(create.status()).toBe(201)
  const obj = await create.json()
  expect(obj.account_id).toBe(accountAId)

  // Clean up
  await adminClient().from('wood_objects').delete().eq('id', obj.id)
})

test('DB key lookup — last_used_at is updated after successful auth', async ({ request }) => {
  const admin = adminClient()

  // Clear last_used_at first
  await admin.from('api_keys').update({ last_used_at: null }).eq('id', testKeyId!)

  await request.get(`${BASE}/api/v1/objects`, {
    headers: { Authorization: `Bearer ${TEST_RAW_KEY}` },
  })

  // Give fire-and-forget a moment to land
  await new Promise(r => setTimeout(r, 500))

  const { data } = await admin.from('api_keys').select('last_used_at').eq('id', testKeyId!).single()
  expect(data?.last_used_at).not.toBeNull()
})

// ── Revocation ────────────────────────────────────────────────────────────────

test('revoked key returns 401', async ({ request }) => {
  const admin = adminClient()
  const revokedRaw  = `rmk_revokedtest${Date.now().toString(16)}`
  const revokedHash = createHash('sha256').update(revokedRaw).digest('hex')

  const userAId = await ensureTestUser()
  const accountAId = await getAccountIdForUser(userAId)

  const { data: inserted } = await admin.from('api_keys').insert({
    account_id: accountAId,
    key_hash:   revokedHash,
    key_prefix: revokedRaw.slice(0, 8),
    label:      'revoke test',
    created_by: userAId,
    revoked_at: new Date().toISOString(),
  }).select('id').single()

  const r = await request.get(`${BASE}/api/v1/objects`, {
    headers: { Authorization: `Bearer ${revokedRaw}` },
  })
  expect(r.status()).toBe(401)

  // Clean up
  if (inserted?.id) await admin.from('api_keys').delete().eq('id', inserted.id)
})

// ── Env var fallback ──────────────────────────────────────────────────────────

test('env var fallback — RINGMARK_API_KEY still returns 200 (dual-mode active)', async ({ request }) => {
  // The existing API tests already exercise this path with the env var key.
  // This test makes it explicit that the fallback is still active.
  const r = await request.get(`${BASE}/api/v1/objects`, {
    headers: { Authorization: `Bearer ${process.env.RINGMARK_API_KEY}` },
  })
  // If RINGMARK_API_KEY is not set in the test environment, this key won't work
  // and the test should be skipped — not a failure of the new code.
  if (!process.env.RINGMARK_API_KEY) {
    console.log('RINGMARK_API_KEY not set — env var fallback not exercised in this environment')
    return
  }
  expect(r.status()).toBe(200)
})
