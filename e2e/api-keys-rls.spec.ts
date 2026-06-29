/**
 * api_keys table tests — step 4 of multi-user plan.
 *
 * Verifies:
 * - Table and RLS policies exist
 * - The migration seed key is present
 * - Owners can read and create keys for their account
 * - Owners cannot create keys for another account
 * - Non-owners (when they exist) cannot create or delete keys (deferred
 *   to multi-user iteration — all test users are owners in this phase)
 */

import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import {
  ensureTestUser, ensureSecondTestUser,
  TEST_EMAIL, TEST_PASSWORD,
  OTHER_TEST_EMAIL, OTHER_TEST_PASSWORD,
  getAccountIdForUser,
} from './helpers/supabase-admin'

const SEEDED_KEY_PREFIX = '6fdea732'

function anonClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

// Track keys created during tests for cleanup
const createdKeyIds: string[] = []

test.afterAll(async () => {
  if (createdKeyIds.length === 0) return
  const admin = adminClient()
  await admin.from('api_keys').delete().in('id', createdKeyIds)
})

// ── Seed verification ─────────────────────────────────────────────────────────

test('seeded env key exists in api_keys with correct prefix and label', async () => {
  const admin = adminClient()
  const { data, error } = await admin
    .from('api_keys')
    .select('key_prefix, label, revoked_at')
    .eq('key_prefix', SEEDED_KEY_PREFIX)
    .maybeSingle()

  expect(error).toBeNull()
  expect(data).not.toBeNull()
  expect(data?.key_prefix).toBe(SEEDED_KEY_PREFIX)
  expect(data?.label).toBe('env key (migrated from RINGMARK_API_KEY)')
  expect(data?.revoked_at).toBeNull()
})

// ── RLS: read ─────────────────────────────────────────────────────────────────

test('owner can read api_keys and only sees their own account keys', async () => {
  const userAId = await ensureTestUser()
  const accountAId = await getAccountIdForUser(userAId)

  const client = anonClient()
  await client.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD })

  const { data, error } = await client.from('api_keys').select('id, key_prefix, account_id')
  expect(error).toBeNull()
  expect(Array.isArray(data)).toBe(true)
  // Every visible key must belong to the authenticated user's account (RLS scoping)
  for (const key of (data ?? [])) {
    expect(key.account_id).toBe(accountAId)
  }
})

test('user cannot read api_keys belonging to another account', async () => {
  // User B signs in and should see zero keys (all keys belong to user A's account)
  const userBId = await ensureSecondTestUser()
  const accountBId = await getAccountIdForUser(userBId)

  // Confirm B has no api_keys (service-role check)
  const admin = adminClient()
  const { data: bKeys } = await admin
    .from('api_keys')
    .select('id')
    .eq('account_id', accountBId)
  expect(bKeys?.length ?? 0).toBe(0)

  // User B's scoped client should see zero rows
  const clientB = anonClient()
  await clientB.auth.signInWithPassword({ email: OTHER_TEST_EMAIL, password: OTHER_TEST_PASSWORD })
  const { data, error } = await clientB.from('api_keys').select('id')
  expect(error).toBeNull()
  expect(data?.length ?? 0).toBe(0)
})

// ── RLS: create ───────────────────────────────────────────────────────────────

test('owner can create an api_key for their account', async () => {
  const userAId = await ensureTestUser()
  const accountAId = await getAccountIdForUser(userAId)

  const client = anonClient()
  const { data: { user } } = await client.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD })

  const fakeRaw = `test-key-create-${Date.now()}`
  const { data, error } = await client.from('api_keys').insert({
    account_id:  accountAId,
    key_hash:    createHash('sha256').update(fakeRaw).digest('hex'),
    key_prefix:  fakeRaw.slice(0, 8),
    label:       'test key — step 4',
    created_by:  user!.id,
  }).select('id').single()

  expect(error, `owner create failed: ${error?.message}`).toBeNull()
  expect(data?.id).toBeTruthy()
  createdKeyIds.push(data!.id)
})

test('owner cannot create an api_key for another account', async () => {
  const userBId = await ensureSecondTestUser()
  const accountBId = await getAccountIdForUser(userBId)

  const client = anonClient()
  const { data: { user } } = await client.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD })

  const fakeRaw = `test-key-cross-${Date.now()}`
  const { error } = await client.from('api_keys').insert({
    account_id:  accountBId,          // user A trying to create in B's account
    key_hash:    createHash('sha256').update(fakeRaw).digest('hex'),
    key_prefix:  fakeRaw.slice(0, 8),
    created_by:  user!.id,
  })

  expect(error, 'cross-account key creation should be blocked').not.toBeNull()
})

// ── RLS: delete ───────────────────────────────────────────────────────────────

test('owner can delete (revoke) their own api_key', async () => {
  const userAId = await ensureTestUser()
  const accountAId = await getAccountIdForUser(userAId)

  // Create a key to delete
  const client = anonClient()
  const { data: { user } } = await client.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD })

  const fakeRaw = `test-key-delete-${Date.now()}`
  const { data: created } = await client.from('api_keys').insert({
    account_id:  accountAId,
    key_hash:    createHash('sha256').update(fakeRaw).digest('hex'),
    key_prefix:  fakeRaw.slice(0, 8),
    label:       'to be deleted',
    created_by:  user!.id,
  }).select('id').single()

  expect(created?.id).toBeTruthy()

  const { error } = await client.from('api_keys').delete().eq('id', created!.id)
  expect(error, `owner delete failed: ${error?.message}`).toBeNull()

  // Confirm it's gone
  const { data: check } = await client.from('api_keys').select('id').eq('id', created!.id).maybeSingle()
  expect(check).toBeNull()
})

test('user cannot delete an api_key from another account', async () => {
  const userAId = await ensureTestUser()
  const accountAId = await getAccountIdForUser(userAId)

  // Create a key as user A (via service role for simplicity)
  const admin = adminClient()
  const fakeRaw = `test-key-nodelete-${Date.now()}`
  const { data: created } = await admin.from('api_keys').insert({
    account_id:  accountAId,
    key_hash:    createHash('sha256').update(fakeRaw).digest('hex'),
    key_prefix:  fakeRaw.slice(0, 8),
    label:       'nodelete test',
    created_by:  userAId,
  }).select('id').single()

  expect(created?.id).toBeTruthy()
  createdKeyIds.push(created!.id)

  // User B attempts to delete it
  const clientB = anonClient()
  await clientB.auth.signInWithPassword({ email: OTHER_TEST_EMAIL, password: OTHER_TEST_PASSWORD })
  await clientB.from('api_keys').delete().eq('id', created!.id)

  // Key must still exist (delete was blocked)
  const { data: check } = await admin.from('api_keys').select('id').eq('id', created!.id).maybeSingle()
  expect(check).not.toBeNull()
})
