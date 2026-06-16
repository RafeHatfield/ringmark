import * as dotenv from 'dotenv'
import path from 'path'
import { createClient } from '@supabase/supabase-js'
import { TEST_EMAIL, OTHER_TEST_EMAIL, deleteTestData } from './helpers/supabase-admin'

dotenv.config({ path: path.join(process.cwd(), '.env.local') })

export default async function globalTeardown() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return

  const client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: { users } } = await client.auth.admin.listUsers()

  const mainUser = users.find(u => u.email === TEST_EMAIL)
  const otherUser = users.find(u => u.email === OTHER_TEST_EMAIL)

  if (mainUser) await deleteTestData(mainUser.id)
  if (otherUser) await deleteTestData(otherUser.id)

  console.log('  ✓ E2E test data cleaned up')
}
