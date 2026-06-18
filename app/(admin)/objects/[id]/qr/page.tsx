import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getOrCreateAccount } from '@/lib/supabase/account'
import { createClient } from '@/lib/supabase/server'
import QrCard from './qr-card'

export default async function QrCardPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const account = await getOrCreateAccount()

  const { data: object } = await supabase
    .from('wood_objects')
    .select('id, workshop_id, public_slug, title, object_type')
    .eq('id', id)
    .eq('account_id', account.id)
    .single()

  if (!object) notFound()

  const publicUrl = `https://ringmark.org/p/${object.public_slug}`

  return (
    <main className="max-w-2xl mx-auto px-4 pt-6 pb-16">
      <div className="flex items-center justify-between mb-6">
        <Link href={`/objects/${id}`} className="text-sm text-bark hover:text-ink">
          ← Back
        </Link>
      </div>

      <h1 className="text-lg font-semibold mb-1">QR Card</h1>
      <p className="text-sm text-bark mb-6">
        <span className="font-mono">{object.workshop_id}</span>
        {object.title && <span className="ml-2">{object.title}</span>}
      </p>

      <QrCard
        workshopId={object.workshop_id}
        publicUrl={publicUrl}
        publicSlug={object.public_slug}
      />
    </main>
  )
}
