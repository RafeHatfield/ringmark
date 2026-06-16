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

export async function ensureTestUser(): Promise<string> {
  const client = adminClient()
  const { data: { users } } = await client.auth.admin.listUsers()
  const existing = users.find(u => u.email === TEST_EMAIL)

  if (existing) {
    // Ensure the password is correct (re-set it so we always have the known password)
    await client.auth.admin.updateUserById(existing.id, { password: TEST_PASSWORD })
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
    await client.auth.admin.updateUserById(existing.id, { password: OTHER_TEST_PASSWORD })
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

export async function updateObjectAdmin(objectId: string, data: Record<string, unknown>): Promise<void> {
  const client = adminClient()
  await client.from('wood_objects').update(data).eq('id', objectId)
}

export async function deleteTestData(userId: string): Promise<void> {
  const client = adminClient()

  // Find the test account
  const { data: account } = await client
    .from('accounts')
    .select('id')
    .eq('owner_user_id', userId)
    .single()

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

  await client.from('accounts').delete().eq('id', account.id)
}
