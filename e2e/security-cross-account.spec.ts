/**
 * Cross-account isolation test suite — step 8 of multi-user plan.
 *
 * Verifies that User B cannot read, modify, or delete any resource belonging
 * to User A — whether through the admin UI or the REST API. Each test uses
 * User B's own valid API key (or browser session), confirming that 404 (not
 * 401) is returned when auth succeeds but the resource belongs to another
 * account.
 *
 * Cases covered (12 total — original 8 from the plan + 4 missed endpoints):
 *  1. Admin UI: B visits A's object page → not-found content
 *  2. GET /objects/:id with B's key → 404
 *  3. PATCH /objects/:id with B's key → 404
 *  4. DELETE /objects/:id with B's key → 404
 *  5. POST /objects/:id/children with B's key → 404
 *  6. POST /objects/:id/photos with B's key → 404
 *  7. GET /objects/:id/photos with B's key → 404
 *  8. PATCH /objects/:id/photos/:photoId with B's key → 404
 *  9. GET /objects/:id/lineage with B's key → 404
 * 10. A's private_notes canary not in B's search results → empty
 * 11. A's API key used against B's resources → 404 (not 401)
 * 12. A's workshop_id not visible in B's object list
 */

import { test, expect } from '@playwright/test'
import path from 'path'
import { createClient } from '@supabase/supabase-js'
import {
  ensureTestUser,
  ensureSecondTestUser,
  getAccountIdForUser,
  createTestApiKey,
  OTHER_TEST_EMAIL,
  OTHER_TEST_PASSWORD,
} from './helpers/supabase-admin'

const AUTH_STATE       = path.join(__dirname, '.auth/user.json')
const OTHER_AUTH_STATE = path.join(__dirname, '.auth/other-user.json')
const BASE             = 'http://localhost:3000'

// Minimal 1×1 PNG for photo upload tests
const MINIMAL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

// Unique canary value — proves account isolation, not just "no results"
const CANARY = `ISO_CANARY_${Date.now()}`

// ── Shared state ──────────────────────────────────────────────────────────────

let objectAId   = ''   // object in Account A
let photoAId    = ''   // photo in Account A
let userBKey    = ''   // Account B API key (for REST calls as B)
let userBKeyId  = ''
let userAKey    = ''   // Account A API key (to test A's key vs B's resources)
let userAKeyId  = ''
let objectBId   = ''   // object in Account B (for test case 11)

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

test.beforeAll(async () => {
  const userAId = await ensureTestUser()
  const userBId = await ensureSecondTestUser()
  const accountAId = await getAccountIdForUser(userAId)
  const accountBId = await getAccountIdForUser(userBId)

  // Create per-run API keys for both accounts
  ;({ rawKey: userAKey, keyId: userAKeyId } = await createTestApiKey(userAId, accountAId, 'iso-suite key A'))
  ;({ rawKey: userBKey, keyId: userBKeyId } = await createTestApiKey(userBId, accountBId, 'iso-suite key B'))

  // Create a test object in Account A with a canary in title and private_notes
  const { data: obj } = await admin().from('wood_objects').insert({
    account_id:    accountAId,
    workshop_id:   `ISOA${Date.now()}`,
    workshop_id_lower: `isoa${Date.now()}`,
    object_type:   'source',
    title:         CANARY,
    private_notes: CANARY,
    public_slug:   `iso-test-${Date.now()}`,
    is_published:  false,
  }).select('id').single()
  if (!obj) throw new Error('Failed to create test object for Account A')
  objectAId = obj.id

  // Upload a photo to that object
  const storagePath = `${accountAId}/${objectAId}/iso-test.png`
  await admin().storage.from('object-photos').upload(storagePath, MINIMAL_PNG, { upsert: true })
  const { data: photo } = await admin().from('object_photos').insert({
    account_id:   accountAId,
    object_id:    objectAId,
    storage_path: storagePath,
    is_public:    true,
    sort_order:   0,
  }).select('id').single()
  if (photo) photoAId = photo.id

  // Create a small object in Account B for test case 11
  const { data: objB } = await admin().from('wood_objects').insert({
    account_id:    accountBId,
    workshop_id:   `ISOB${Date.now()}`,
    workshop_id_lower: `isob${Date.now()}`,
    object_type:   'source',
    public_slug:   `iso-test-b-${Date.now()}`,
    is_published:  false,
  }).select('id').single()
  if (objB) objectBId = objB.id
})

test.afterAll(async () => {
  const db = admin()
  // Photos cascade-delete with their object; storage path must be removed separately
  if (photoAId) {
    const { data: p } = await db.from('object_photos').select('storage_path').eq('id', photoAId).maybeSingle()
    if (p) await db.storage.from('object-photos').remove([p.storage_path])
  }
  if (objectAId) await db.from('wood_objects').delete().eq('id', objectAId)
  if (objectBId) await db.from('wood_objects').delete().eq('id', objectBId)
  if (userAKeyId) await db.from('api_keys').delete().eq('id', userAKeyId)
  if (userBKeyId) await db.from('api_keys').delete().eq('id', userBKeyId)
})

function bHeaders() {
  return { Authorization: `Bearer ${userBKey}`, 'Content-Type': 'application/json' }
}
function aHeaders() {
  return { Authorization: `Bearer ${userAKey}`, 'Content-Type': 'application/json' }
}

// ── Case 1: Admin UI ──────────────────────────────────────────────────────────

test('1. admin UI — User B visiting User A object gets not-found, not login redirect', async ({ browser }) => {
  // Log in fresh — saved auth state can expire between suites
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto(`${BASE}/login`)
  await page.fill('#email', OTHER_TEST_EMAIL)
  await page.fill('#password', OTHER_TEST_PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL(`${BASE}/workshop`)

  await page.goto(`${BASE}/objects/${objectAId}`)
  await page.waitForLoadState('networkidle')
  await expect(page.getByText('Object not found')).toBeVisible({ timeout: 10000 })
  await expect(page).not.toHaveURL(/\/login/)
  await ctx.close()
})

// ── Cases 2–9: REST API with User B's key ─────────────────────────────────────

test('2. GET /objects/:id — B key against A object → 404', async ({ request }) => {
  const r = await request.get(`${BASE}/api/v1/objects/${objectAId}`, { headers: bHeaders() })
  expect(r.status()).toBe(404)
})

test('3. PATCH /objects/:id — B key against A object → 404', async ({ request }) => {
  const r = await request.patch(`${BASE}/api/v1/objects/${objectAId}`, {
    headers: bHeaders(),
    data: { title: 'should not work' },
  })
  expect(r.status()).toBe(404)
})

test('4. DELETE /objects/:id — B key against A object → 404', async ({ request }) => {
  const r = await request.delete(`${BASE}/api/v1/objects/${objectAId}`, { headers: bHeaders() })
  expect(r.status()).toBe(404)
  // Confirm object still exists as A
  const check = await request.get(`${BASE}/api/v1/objects/${objectAId}`, { headers: aHeaders() })
  expect(check.status()).toBe(200)
})

test('5. POST /objects/:id/children — B key against A object → 404', async ({ request }) => {
  const r = await request.post(`${BASE}/api/v1/objects/${objectAId}/children`, {
    headers: bHeaders(),
    data: { object_type: 'log' },
  })
  expect(r.status()).toBe(404)
})

test('6. POST /objects/:id/photos — B key against A object → 404', async ({ request }) => {
  const r = await request.post(`${BASE}/api/v1/objects/${objectAId}/photos`, {
    headers: { Authorization: `Bearer ${userBKey}` },
    multipart: { file: { name: 'x.png', mimeType: 'image/png', buffer: MINIMAL_PNG } },
  })
  expect(r.status()).toBe(404)
})

test('7. GET /objects/:id/photos — B key against A object → 404', async ({ request }) => {
  const r = await request.get(`${BASE}/api/v1/objects/${objectAId}/photos`, { headers: bHeaders() })
  expect(r.status()).toBe(404)
})

test('8. PATCH /objects/:id/photos/:photoId — B key against A photo → 404', async ({ request }) => {
  const r = await request.patch(
    `${BASE}/api/v1/objects/${objectAId}/photos/${photoAId}`,
    { headers: bHeaders(), data: { caption: 'should not work' } },
  )
  expect(r.status()).toBe(404)
})

test('9. GET /objects/:id/lineage — B key against A object → 404', async ({ request }) => {
  const r = await request.get(`${BASE}/api/v1/objects/${objectAId}/lineage`, { headers: bHeaders() })
  expect(r.status()).toBe(404)
})

// ── Case 10: private_notes canary not in B's search ───────────────────────────

test("10. A's private_notes/title canary not visible in B's search results", async ({ request }) => {
  // Canary is in A's object title — B's search should return 0 results
  const r = await request.get(`${BASE}/api/v1/objects?q=${encodeURIComponent(CANARY)}`, {
    headers: bHeaders(),
  })
  expect(r.status()).toBe(200)
  const body = await r.json()
  expect(body.total).toBe(0)
  expect(body.data.length).toBe(0)

  // Verify A can find it (proves the object exists with that title)
  const ra = await request.get(`${BASE}/api/v1/objects?q=${encodeURIComponent(CANARY)}`, {
    headers: aHeaders(),
  })
  expect((await ra.json()).total).toBeGreaterThanOrEqual(1)
})

// ── Case 11: A's key used against B's resources → 404 not 401 ────────────────

test("11. A's API key used against B's resource → 404 (auth OK, object not in A's account)", async ({ request }) => {
  // Auth succeeds (A's key is valid) but objectBId belongs to B, not A
  const r = await request.get(`${BASE}/api/v1/objects/${objectBId}`, { headers: aHeaders() })
  expect(r.status()).toBe(404)
  const body = await r.json()
  expect(body).toHaveProperty('error')
  // Must be 404 not 401 — auth succeeded, resource doesn't exist in A's account
})

// ── Case 12: A's objects absent from B's list ────────────────────────────────

test("12. B's object list never includes A's workshop IDs", async ({ request }) => {
  // List all of B's objects — A's canary object must not appear
  const r = await request.get(`${BASE}/api/v1/objects?limit=50`, { headers: bHeaders() })
  expect(r.status()).toBe(200)
  const body = await r.json()
  const ids = body.data.map((o: { id: string }) => o.id)
  expect(ids).not.toContain(objectAId)
  // Canary title must not appear in B's list
  const titles = body.data.map((o: { title?: string }) => o.title ?? '')
  expect(titles.some((t: string) => t.includes(CANARY))).toBe(false)
})
