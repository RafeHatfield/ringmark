import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getOrCreateAccount } from '@/lib/supabase/account'
import { createClient } from '@/lib/supabase/server'
import { SIGNED_URL_EXPIRY, typeLabel } from '@/lib/constants'
import { signPathsBatch } from '@/lib/signed-urls'
import { EventStatus } from './event-status'
import { ItemPicker, type PickerObject } from './item-picker'
import { ItemList, type MarketItemRow } from './item-list'

/**
 * Upper bound on the objects loaded into the picker. The picker filters this
 * set in the browser so selection survives typing — no round trip per
 * keystroke, no lost checkboxes. Well above a realistic workshop; if it's ever
 * hit the UI says so rather than silently truncating.
 */
const CANDIDATE_LIMIT = 500

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

export default async function MarketEventPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const account = await getOrCreateAccount()

  const { data: event } = await supabase
    .from('market_events')
    .select('*')
    .eq('id', id)
    .eq('account_id', account.id)
    .single()

  if (!event) notFound()

  const [{ data: itemRows }, { data: candidateRows }] = await Promise.all([
    supabase
      .from('market_event_items')
      .select('id, object_id, asking_price_cents, sold, sold_price_cents, sort_order')
      .eq('market_event_id', event.id)
      .eq('account_id', account.id)
      .order('sort_order', { ascending: true }),
    supabase
      .from('wood_objects')
      .select('id, workshop_id, title, species, object_type, status, price_cents')
      .eq('account_id', account.id)
      .order('updated_at', { ascending: false })
      .limit(CANDIDATE_LIMIT),
  ])

  const rows = itemRows ?? []
  const objectIds = [...new Set(rows.map((r) => r.object_id))]

  // Display fields for the items, and a thumbnail from each object's first
  // live photo. Photo deletes are soft — deleted_at must stay filtered.
  const [{ data: itemObjects }, { data: photos }] = await Promise.all([
    objectIds.length
      ? supabase
          .from('wood_objects')
          .select('id, workshop_id, title, species')
          .eq('account_id', account.id)
          .in('id', objectIds)
      : Promise.resolve({ data: [] }),
    objectIds.length
      ? supabase
          .from('object_photos')
          .select('object_id, storage_path, sort_order')
          .eq('account_id', account.id)
          .in('object_id', objectIds)
          .is('deleted_at', null)
          .order('sort_order', { ascending: true })
      : Promise.resolve({ data: [] }),
  ])

  const objectById = new Map((itemObjects ?? []).map((o) => [o.id, o]))

  const firstPhotoByObject = new Map<string, string>()
  for (const photo of photos ?? []) {
    if (!firstPhotoByObject.has(photo.object_id)) {
      firstPhotoByObject.set(photo.object_id, photo.storage_path)
    }
  }

  const signedByPath = await signPathsBatch(
    supabase.storage,
    'object-photos',
    [...firstPhotoByObject.values()],
    SIGNED_URL_EXPIRY,
  )

  const items: MarketItemRow[] = rows.map((row) => {
    const obj = objectById.get(row.object_id)
    const path = firstPhotoByObject.get(row.object_id)
    return {
      id: row.id,
      object_id: row.object_id,
      workshop_id: obj?.workshop_id ?? '',
      title: obj?.title ?? null,
      species: obj?.species ?? null,
      asking_price_cents: row.asking_price_cents,
      sold: row.sold,
      sold_price_cents: row.sold_price_cents,
      sort_order: row.sort_order,
      thumbnailUrl: path ? (signedByPath.get(path) ?? null) : null,
    }
  })

  const onEvent = new Set(objectIds)
  const allCandidates = candidateRows ?? []
  const candidates: PickerObject[] = allCandidates
    .filter((o) => !onEvent.has(o.id))
    .map((o) => ({
      id: o.id,
      workshop_id: o.workshop_id,
      title: o.title,
      species: o.species,
      typeLabel: typeLabel(o.object_type),
      status: o.status,
      price_cents: o.price_cents,
    }))

  return (
    <main className="mx-auto max-w-2xl px-4 pb-16 pt-4">
      <div className="mb-5 flex items-center justify-between">
        <Link href="/markets" className="text-sm text-bark hover:text-ink">
          ← Markets
        </Link>
      </div>

      {/* Header */}
      <div className="mb-6">
        <h1 className="font-fraunces text-3xl tracking-tight">{event.name}</h1>
        <div className="mt-1 space-y-0.5 text-sm text-bark">
          {event.event_date && <p>{formatEventDate(event.event_date)}</p>}
          {event.location_text && <p>{event.location_text}</p>}
        </div>
        <div className="mt-3">
          <EventStatus eventId={event.id} status={event.status} />
        </div>
        {event.notes && (
          <p className="mt-3 whitespace-pre-wrap rounded-md border border-hairline px-3 py-2 text-sm text-bark">
            {event.notes}
          </p>
        )}
      </div>

      {/* Print views */}
      <div className="mb-8 flex flex-wrap gap-2">
        <Link
          href={`/markets/${event.id}/pack`}
          className="rounded-md border border-hairline px-3 py-1.5 text-sm transition-colors hover:bg-sand"
        >
          Packing list
        </Link>
        <Link
          href={`/markets/${event.id}/price-sheet`}
          className="rounded-md border border-hairline px-3 py-1.5 text-sm transition-colors hover:bg-sand"
        >
          Price sheet
        </Link>
        <Link
          href={`/markets/${event.id}/labels`}
          className="rounded-md border border-hairline px-3 py-1.5 text-sm transition-colors hover:bg-sand"
        >
          QR labels
        </Link>
      </div>

      {/* Picker */}
      <section className="mb-8">
        <h2 className="mb-3 text-xs tracking-wider text-bark">Add pieces</h2>
        <ItemPicker
          marketEventId={event.id}
          candidates={candidates}
          capped={allCandidates.length === CANDIDATE_LIMIT}
          defaultOpen={items.length === 0}
        />
      </section>

      {/* Items + totals */}
      <section>
        <h2 className="mb-3 text-xs tracking-wider text-bark">
          On this market ({items.length})
        </h2>
        <ItemList items={items} />
      </section>
    </main>
  )
}
