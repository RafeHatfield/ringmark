import type { Metadata } from 'next'
import { permanentRedirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { APP_URL, FINISHED_STATUSES } from '@/lib/constants'
import { MakerProfile, makerMetadata } from '@/components/maker-profile'

export async function generateMetadata(): Promise<Metadata> {
  const admin = createAdminClient()
  const { data: account } = await admin
    .from('accounts')
    .select('display_name, workshop_name, name, bio, handle')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (account?.handle) {
    permanentRedirect(`/${account.handle}/maker`)
  }

  return makerMetadata(account, `${APP_URL}/maker`)
}

export default async function MakerPage() {
  const admin = createAdminClient()

  const { data: account } = await admin
    .from('accounts')
    .select('id, display_name, workshop_name, name, bio, avatar_storage_path, website_url, handle')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!account) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center px-4">
        <p className="text-[14px] text-bark">Nothing here yet.</p>
      </div>
    )
  }

  if (account.handle) {
    permanentRedirect(`/${account.handle}/maker`)
  }

  // Finished work only — a published log or blank has its own story page but isn't portfolio.
  // Public fields only, never private_notes / location_text / workshop_id.
  const { data: pieces } = await admin
    .from('wood_objects')
    .select('public_slug, public_title, title, species, updated_at')
    .eq('account_id', account.id)
    .eq('is_published', true)
    .in('status', FINISHED_STATUSES)
    .order('updated_at', { ascending: false })

  return <MakerProfile account={account} pieces={pieces} canonicalUrl={`${APP_URL}/maker`} />
}
