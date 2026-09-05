import { createClient } from '@supabase/supabase-js'

export const TEST_EMAIL = process.env.E2E_TEST_EMAIL ?? 'e2e@ringmark.local'
export const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD ?? 'RingmarkE2E2026!'

export const OTHER_TEST_EMAIL = process.env.E2E_OTHER_EMAIL ?? 'e2e-other@ringmark.local'
export const OTHER_TEST_PASSWORD = process.env.E2E_OTHER_PASSWORD ?? 'RingmarkE2EOther2026!'

function supabaseBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  // Strip any accidental path suffix (e.g. "/rest/v1/") — NEXT_PUBLIC_SUPABASE_URL
  // must be just the project root: https://[ref].supabase.co
  try {
    const { protocol, host } = new URL(raw)
    return `${protocol}//${host}`
  } catch {
    return raw
  }
}

function adminClient() {
  const url = supabaseBaseUrl()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for E2E tests')
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/**
 * True if the account can currently sign in with this password.
 *
 * Uses the anon client and a local sign-out, so it creates a throwaway session
 * without disturbing any other.
 */
async function passwordWorks(email: string, password: string): Promise<boolean> {
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!anonKey) return false
  const probe = createClient(supabaseBaseUrl(), anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error } = await probe.auth.signInWithPassword({ email, password })
  if (!error) await probe.auth.signOut({ scope: 'local' })
  return !error
}

export async function ensureTestUser(): Promise<string> {
  const client = adminClient()
  const { data: { users } } = await client.auth.admin.listUsers()
  const existing = users.find(u => u.email === TEST_EMAIL)

  if (existing) {
    // Only reset the password when it is actually wrong.
    //
    // Setting a password revokes every existing session for that user. This
    // helper runs in the beforeAll of several API/RLS specs, which sort ahead of
    // the browser specs — so an unconditional reset silently invalidated the
    // shared storageState global-setup had just written, and every spec relying
    // on it failed with a redirect to /login. Individual spec runs passed
    // because global-setup re-wrote the state moments earlier.
    if (!(await passwordWorks(TEST_EMAIL, TEST_PASSWORD))) {
      await client.auth.admin.updateUserById(existing.id, { password: TEST_PASSWORD })
    }
    return existing.id
  }

  const { data, error } = await client.auth.admin.createUser({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    email_confirm: true,
  })
  if (error || !data.user) throw new Error(`Failed to create test user: ${error?.message}`)
  return data.user.id
}

export async function ensureSecondTestUser(): Promise<string> {
  const client = adminClient()
  const { data: { users } } = await client.auth.admin.listUsers()
  const existing = users.find(u => u.email === OTHER_TEST_EMAIL)

  if (existing) {
    // Same reasoning as ensureTestUser: an unconditional password reset revokes
    // this user's sessions, including the shared other-user storageState.
    if (!(await passwordWorks(OTHER_TEST_EMAIL, OTHER_TEST_PASSWORD))) {
      await client.auth.admin.updateUserById(existing.id, { password: OTHER_TEST_PASSWORD })
    }
    return existing.id
  }

  const { data, error } = await client.auth.admin.createUser({
    email: OTHER_TEST_EMAIL,
    password: OTHER_TEST_PASSWORD,
    email_confirm: true,
  })
  if (error || !data.user) throw new Error(`Failed to create second test user: ${error?.message}`)
  return data.user.id
}

export async function createTestApiKey(
  userId: string,
  accountId: string,
  label = 'isolation test key',
): Promise<{ rawKey: string; keyId: string }> {
  const { createHash } = await import('crypto')
  const rawKey  = `rmk_isokey${Date.now().toString(16)}${Math.random().toString(36).slice(2)}`
  const keyHash = createHash('sha256').update(rawKey).digest('hex')
  const client  = adminClient()
  const { data, error } = await client.from('api_keys').insert({
    account_id: accountId,
    key_hash:   keyHash,
    key_prefix: rawKey.slice(0, 8),
    label,
    created_by: userId,
  }).select('id').single()
  if (error || !data) throw new Error(`Failed to create test API key: ${error?.message}`)
  return { rawKey, keyId: data.id }
}

export async function updateObjectAdmin(objectId: string, data: Record<string, unknown>): Promise<void> {
  const client = adminClient()
  await client.from('wood_objects').update(data).eq('id', objectId)
}

export async function updatePhotoAdmin(photoId: string, data: Record<string, unknown>): Promise<void> {
  const client = adminClient()
  await client.from('object_photos').update(data).eq('id', photoId)
}

/**
 * Reads a photo row directly, including the upload columns the API never
 * exposes. Used to assert that the plaintext upload token is not persisted.
 */
export async function getPhotoRowAdmin(photoId: string): Promise<Record<string, unknown> | null> {
  const client = adminClient()
  const { data } = await client.from('object_photos').select('*').eq('id', photoId).maybeSingle()
  return data ?? null
}

export async function getAccountIdForUser(userId: string): Promise<string> {
  const client = adminClient()
  const { data } = await client
    .from('account_members')
    .select('account_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle()
  if (!data) throw new Error(`No account found for user ${userId}`)
  return data.account_id
}

export async function getRoleForUser(userId: string): Promise<string | null> {
  const client = adminClient()
  const { data } = await client
    .from('account_members')
    .select('role')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle()
  return data?.role ?? null
}

export async function deleteTestData(userId: string): Promise<void> {
  const client = adminClient()

  // Find the test account via account_members (not owner_user_id — future-proof for invited members)
  const { data: membership } = await client
    .from('account_members')
    .select('account_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle()

  const account = membership ? { id: membership.account_id } : null

  if (!account) return

  // Delete all photos first (storage paths), then objects, then account
  const { data: objects } = await client
    .from('wood_objects')
    .select('id')
    .eq('account_id', account.id)

  if (objects && objects.length > 0) {
    const objectIds = objects.map(o => o.id)

    const { data: photos } = await client
      .from('object_photos')
      .select('storage_path')
      .in('object_id', objectIds)

    if (photos && photos.length > 0) {
      const paths = photos.map(p => p.storage_path)
      await client.storage.from('object-photos').remove(paths)
      await client.from('object_photos').delete().in('object_id', objectIds)
    }

    await client.from('wood_objects').delete().eq('account_id', account.id)
  }

  // account_members and account_invites cascade-delete with the account
  await client.from('accounts').delete().eq('id', account.id)
}
