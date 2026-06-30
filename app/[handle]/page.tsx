import { redirect, notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'

// /{handle} redirects to /{handle}/maker until a workshop showcase page exists.
export default async function HandlePage({
  params,
}: {
  params: Promise<{ handle: string }>
}) {
  const { handle } = await params
  const admin = createAdminClient()

  const { data } = await admin
    .from('accounts')
    .select('handle')
    .eq('handle', handle)
    .maybeSingle()

  if (!data) notFound()

  redirect(`/${handle}/maker`)
}
