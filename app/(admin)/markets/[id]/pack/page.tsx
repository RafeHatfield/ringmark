import { notFound } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { getOrCreateAccount } from '@/lib/supabase/account'
import { createClient } from '@/lib/supabase/server'
import { SIGNED_URL_EXPIRY } from '@/lib/constants'
import { signPathsBatch } from '@/lib/signed-urls'

/** 'YYYY-MM-DD' -> a readable date, parsed as local parts so it never shifts a day. */
function formatEventDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return date
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

type PackItem = {
  id: string
  workshopId: string
  title: string | null
  thumbnailUrl: string | null
}

// "Did I put it in the van" checklist for a market event — one checkbox per
// item, no prices. Checkboxes are plain uncontrolled inputs (nothing to
// persist; this is a paper-and-pen list, not a saved state).
export default async function MarketPackPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const account = await getOrCreateAccount()

  const { data: event } = await supabase
    .from('market_events')
    .select('id, name, event_date')
    .eq('id', id)
    .eq('account_id', account.id)
    .maybeSingle()

  if (!event) notFound()

  const { data: rows } = await supabase
    .from('market_event_items')
    .select('id, object_id, sort_order')
    .eq('market_event_id', event.id)
    .eq('account_id', account.id)
    .order('sort_order', { ascending: true })

  const itemRows = rows ?? []
  const objectIds = [...new Set(itemRows.map((r) => r.object_id))]

  const { data: objects } = objectIds.length
    ? await supabase
        .from('wood_objects')
        .select('id, workshop_id, title')
        .eq('account_id', account.id)
        .in('id', objectIds)
    : { data: [] }
  const objectById = new Map((objects ?? []).map((o) => [o.id, o]))

  // First (lowest sort_order) non-deleted photo per object, for thumbnails.
  // Photo deletes are soft, so this must stay filtered by deleted_at.
  const { data: photos } = objectIds.length
    ? await supabase
        .from('object_photos')
        .select('object_id, storage_path, sort_order')
        .eq('account_id', account.id)
        .in('object_id', objectIds)
        .is('deleted_at', null)
        .order('sort_order', { ascending: true })
    : { data: [] }

  const firstPhotoPathByObject = new Map<string, string>()
  for (const photo of photos ?? []) {
    if (!firstPhotoPathByObject.has(photo.object_id)) {
      firstPhotoPathByObject.set(photo.object_id, photo.storage_path)
    }
  }

  const signedByPath = await signPathsBatch(
    supabase.storage,
    'object-photos',
    [...firstPhotoPathByObject.values()],
    SIGNED_URL_EXPIRY,
  )

  const items: PackItem[] = itemRows.map((row) => {
    const obj = objectById.get(row.object_id)
    const path = firstPhotoPathByObject.get(row.object_id)
    return {
      id: row.id,
      workshopId: obj?.workshop_id ?? '—',
      title: obj?.title ?? null,
      thumbnailUrl: path ? (signedByPath.get(path) ?? null) : null,
    }
  })

  return (
    <main className="mx-auto max-w-2xl px-4 pb-16 pt-6">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Link href={`/markets/${event.id}`} className="text-sm text-bark hover:text-ink">
          ← Back to market
        </Link>
      </div>

      <h1 className="mb-1 font-fraunces text-2xl tracking-tight">Packing List</h1>
      <p className="mb-6 text-sm text-bark">
        {event.name}
        {event.event_date && <span className="ml-2">· {formatEventDate(event.event_date)}</span>}
      </p>

      {items.length === 0 ? (
        <p className="text-sm text-bark">Nothing on this market yet.</p>
      ) : (
        <div className="divide-y divide-hairline rounded-md border border-hairline">
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-3 break-inside-avoid px-4 py-3">
              <input
                type="checkbox"
                aria-label={`Packed: ${item.workshopId}`}
                className="h-5 w-5 shrink-0 accent-cedar"
              />
              <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded bg-sand">
                {item.thumbnailUrl && (
                  <Image
                    src={item.thumbnailUrl}
                    alt=""
                    fill
                    sizes="48px"
                    className="object-cover"
                  />
                )}
              </div>
              <div className="min-w-0">
                <p className="font-mono text-sm font-medium">{item.workshopId}</p>
                {item.title && <p className="truncate text-sm text-bark">{item.title}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      <style>{`
        @media print {
          @page { margin: 12mm; }
          header { display: none !important; }
        }
      `}</style>
    </main>
  )
}
