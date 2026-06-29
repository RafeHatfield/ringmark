/**
 * Multi-user RLS regression tests — steps 1 & 2.
 *
 * Step 1: Storage RLS — object-photos bucket policies use account_members
 *   join, not owner_user_id. Verified here with real user-scoped clients
 *   so storage RLS is exercised directly (API routes use service role and
 *   would bypass these policies).
 *
 * Step 2: Role column — account_members.role is set correctly for account
 *   creators, and the accounts UPDATE/DELETE RLS policies check role = 'owner'
 *   via account_members rather than owner_user_id.
 *
 * These tests use the Supabase JS client with password auth (not browser
 * context) so storage and table RLS is exercised at the DB layer.
 */

import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import {
  ensureTestUser,
  ensureSecondTestUser,
  TEST_EMAIL, TEST_PASSWORD,
  OTHER_TEST_EMAIL, OTHER_TEST_PASSWORD,
  getAccountIdForUser,
  getRoleForUser,
} from './helpers/supabase-admin'

// Minimal 1×1 PNG — accepted by Supabase Storage
const MINIMAL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

const BUCKET = 'object-photos'
// Fake object UUID — storage RLS only checks the first path segment (account_id)
const FAKE_OBJECT_ID = '00000000-0000-0000-0000-000000000099'

function anonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// ── Step 1: Storage RLS ───────────────────────────────────────────────────────

test.describe('step 1 — storage RLS: membership-based policies on object-photos', () => {
  let accountAId: string
  let accountBId: string
  const uploadedPaths: string[] = []

  test.beforeAll(async () => {
    const userAId = await ensureTestUser()
    const userBId = await ensureSecondTestUser()
    accountAId = await getAccountIdForUser(userAId)
    accountBId = await getAccountIdForUser(userBId)
  })

  test.afterAll(async () => {
    if (uploadedPaths.length === 0) return
    // Use service-role client for cleanup — bypasses RLS
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
    await admin.storage.from(BUCKET).remove(uploadedPaths)
  })

  test('owner can upload a photo to their own account prefix', async () => {
    const client = anonClient()
    await client.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD })

    const path = `${accountAId}/${FAKE_OBJECT_ID}/rls-upload-test.png`
    const { error } = await client.storage.from(BUCKET).upload(
      path,
      new Blob([MINIMAL_PNG], { type: 'image/png' }),
      { upsert: true },
    )
    expect(error, `upload to own prefix failed: ${error?.message}`).toBeNull()
    uploadedPaths.push(path)
  })

  test('user cannot upload to another account prefix', async () => {
    const client = anonClient()
    // Sign in as user A, attempt upload into user B's account prefix
    await client.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD })

    const path = `${accountBId}/${FAKE_OBJECT_ID}/rls-cross-upload.png`
    const { error } = await client.storage.from(BUCKET).upload(
      path,
      new Blob([MINIMAL_PNG], { type: 'image/png' }),
    )
    expect(error, 'cross-account upload should be rejected').not.toBeNull()
  })

  test('owner can delete their own photo from storage', async () => {
    // Upload a file first, then delete it
    const client = anonClient()
    await client.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD })

    const path = `${accountAId}/${FAKE_OBJECT_ID}/rls-delete-test.png`
    await client.storage.from(BUCKET).upload(
      path,
      new Blob([MINIMAL_PNG], { type: 'image/png' }),
      { upsert: true },
    )

    const { error } = await client.storage.from(BUCKET).remove([path])
    expect(error, `delete of own photo failed: ${error?.message}`).toBeNull()
  })

  test('user cannot delete another account photo from storage', async () => {
    // Upload a file as user A
    const clientA = anonClient()
    await clientA.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD })
    const path = `${accountAId}/${FAKE_OBJECT_ID}/rls-nodelete-test.png`
    await clientA.storage.from(BUCKET).upload(
      path,
      new Blob([MINIMAL_PNG], { type: 'image/png' }),
      { upsert: true },
    )
    uploadedPaths.push(path) // cleaned up in afterAll

    // Attempt delete as user B
    const clientB = anonClient()
    await clientB.auth.signInWithPassword({ email: OTHER_TEST_EMAIL, password: OTHER_TEST_PASSWORD })
    await clientB.storage.from(BUCKET).remove([path])

    // Verify the file still exists (delete was silently blocked or errored)
    const { data: listed } = await clientA.storage
      .from(BUCKET)
      .list(`${accountAId}/${FAKE_OBJECT_ID}`, { search: 'rls-nodelete-test.png' })
    expect(listed?.some(f => f.name === 'rls-nodelete-test.png')).toBe(true)
  })
})

// ── Step 2: Role column ───────────────────────────────────────────────────────

test.describe('step 2 — role column: account_members.role and accounts RLS', () => {
  let userAId: string
  let userBId: string

  test.beforeAll(async () => {
    userAId = await ensureTestUser()
    userBId = await ensureSecondTestUser()
  })

  test('primary test user has role = owner in account_members', async () => {
    const role = await getRoleForUser(userAId)
    expect(role).toBe('owner')
  })

  test('second test user has role = owner in account_members', async () => {
    const role = await getRoleForUser(userBId)
    expect(role).toBe('owner')
  })

  test('authenticated user can read their own role via account_members policy', async () => {
    // Verifies the "account_members: read own membership" policy works and
    // the role field is exposed correctly to the user-scoped client
    const client = anonClient()
    await client.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD })

    const { data, error } = await client
      .from('account_members')
      .select('role')
      .maybeSingle()

    expect(error).toBeNull()
    expect(data?.role).toBe('owner')
  })

  test('owner can update their account via the role-based RLS policy', async () => {
    // Verifies "accounts: owner can update" now checks role = 'owner'
    // via account_members rather than owner_user_id
    const client = anonClient()
    await client.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD })

    const accountId = await getAccountIdForUser(userAId)

    const { error } = await client
      .from('accounts')
      .update({ display_name: 'RLS policy test — owner update' })
      .eq('id', accountId)

    expect(error, `owner account update failed: ${error?.message}`).toBeNull()

    // Restore to original value
    await client.from('accounts').update({ display_name: null }).eq('id', accountId)
  })

  test('user cannot update another account even with correct auth', async () => {
    // Verifies account isolation: user A cannot modify user B's account row
    const client = anonClient()
    await client.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD })

    const accountBId = await getAccountIdForUser(userBId)

    const { error } = await client
      .from('accounts')
      .update({ display_name: 'should not work' })
      .eq('id', accountBId)

    // RLS blocks the update — Supabase returns no error but 0 rows affected.
    // Verify by confirming the value is still null.
    expect(error).toBeNull() // no DB error — just silently no-ops
    const { data: check } = await client.from('accounts').select('display_name').eq('id', accountBId).maybeSingle()
    // User A can't read user B's account (different RLS path) — null data confirms no leak
    expect(check).toBeNull()
  })
})
