/**
 * One-time seeding script: hashes the existing RINGMARK_API_KEY env var and
 * inserts it into the api_keys table for the owner account.
 *
 * Run ONCE after deploying the api_keys migration and BEFORE deploying the
 * code that switches verifyApiKey() to use DB lookups (step 6). Running it
 * again is safe — it exits cleanly if the key is already seeded.
 *
 * Usage:
 *   npx tsx scripts/seed-api-key.ts
 *
 * Requires .env.local with:
 *   RINGMARK_API_KEY
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createHash } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env.local') })

const RAW_KEY   = process.env.RINGMARK_API_KEY
const SUPA_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPA_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!RAW_KEY)  { console.error('RINGMARK_API_KEY is not set in .env.local'); process.exit(1) }
if (!SUPA_URL) { console.error('NEXT_PUBLIC_SUPABASE_URL is not set in .env.local'); process.exit(1) }
if (!SUPA_KEY) { console.error('SUPABASE_SERVICE_ROLE_KEY is not set in .env.local'); process.exit(1) }

const db = createClient(SUPA_URL, SUPA_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function main() {
  const keyHash   = createHash('sha256').update(RAW_KEY!).digest('hex')
  const keyPrefix = RAW_KEY!.slice(0, 8)

  // Idempotent — skip if already seeded
  const { data: existing } = await db
    .from('api_keys')
    .select('id, label')
    .eq('key_hash', keyHash)
    .maybeSingle()

  if (existing) {
    console.log(`Key already seeded (id: ${existing.id}, label: "${existing.label ?? 'none'}"). Nothing to do.`)
    return
  }

  // Find the owner account and user
  const { data: membership } = await db
    .from('account_members')
    .select('account_id, user_id')
    .eq('role', 'owner')
    .limit(1)
    .maybeSingle()

  if (!membership) {
    console.error('No owner account found — run the app once to trigger account creation first.')
    process.exit(1)
  }

  const { error } = await db.from('api_keys').insert({
    account_id:  membership.account_id,
    key_hash:    keyHash,
    key_prefix:  keyPrefix,
    label:       'env key (migrated from RINGMARK_API_KEY)',
    created_by:  membership.user_id,
  })

  if (error) {
    console.error('Insert failed:', error.message)
    process.exit(1)
  }

  console.log(`Seeded key for account ${membership.account_id}`)
  console.log(`  Prefix:  ${keyPrefix}...`)
  console.log(`  Hash:    ${keyHash.slice(0, 16)}...`)
  console.log(`  Label:   env key (migrated from RINGMARK_API_KEY)`)
  console.log()
  console.log('Next: deploy the verifyApiKey() DB-lookup code (step 6), then verify')
  console.log('it works before removing RINGMARK_API_KEY from the environment.')
}

main().catch((err) => { console.error(err); process.exit(1) })
