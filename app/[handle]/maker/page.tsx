import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { APP_URL } from '@/lib/constants'
import { MakerProfile, makerMetadata } from '@/components/maker-profile'

type Props = { params: Promise<{ handle: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params
  const admin = createAdminClient()

  const { data: account } = await admin
    .from('accounts')
    .select('display_name, workshop_name, name, bio')
    .eq('handle', handle)
    .maybeSingle()

  if (!account) return {}

  return makerMetadata(account, `${APP_URL}/${handle}/maker`)
}

export default async function HandleMakerPage({ params }: Props) {
  const { handle } = await params
  const admin = createAdminClient()

  const { data: account } = await admin
    .from('accounts')
    .select('id, display_name, workshop_name, name, bio, avatar_storage_path, website_url')
    .eq('handle', handle)
    .maybeSingle()

  if (!account) notFound()

  const { data: pieces } = await admin
    .from('wood_objects')
    .select('public_slug, public_title, title, species, updated_at')
    .eq('account_id', account.id)
    .eq('is_published', true)
    .order('updated_at', { ascending: false })

  return <MakerProfile account={account} pieces={pieces} canonicalUrl={`${APP_URL}/${handle}/maker`} />
}
