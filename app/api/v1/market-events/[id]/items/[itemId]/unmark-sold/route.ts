import { authenticateApiRequest } from '@/lib/api-auth'
import { createServiceClient, type ServiceClient } from '@/lib/supabase/service'
import { signPathsBatch } from '@/lib/signed-urls'
import type { MarketEventItem } from '@/lib/types'

const BUCKET = 'object-photos'
const SIGNED_URL_EXPIRY_SECONDS = 3600

// ── POST /api/v1/market-events/:id/items/:itemId/unmark-sold ─────────────────
//
// Reverses mark-sold: clears sold/sold_price_cents/sold_at, and reverts
// wood_objects.status to 'for_sale' unconditionally — not whatever it was
// before. This is a deliberate, documented simplification (see
// tasks/market-mode-plan.md, Task 1.3): an object added to a market event was
// almost certainly 'for_sale' beforehand, and this avoids a redundant
// "previous status" column. Same cross-table cascade shape as mark-sold —
// two explicit scoped updates, no trigger.

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { id, itemId } = await params
  const db = createServiceClient()
  const { account, error: authErr } = await authenticateApiRequest(request, db)
  if (authErr) return authErr

  const { data: event } = await db
    .from('market_events')
    .select('id')
    .eq('id', id)
    .eq('account_id', account.id)
    .maybeSingle()

  if (!event) {
    return Response.json({ error: 'Market event not found' }, { status: 404 })
  }

  const { data: item } = await db
    .from('market_event_items')
    .select('*')
    .eq('id', itemId)
    .eq('market_event_id', event.id)
    .eq('account_id', account.id)
    .maybeSingle()

  if (!item) {
    return Response.json({ error: 'Item not found' }, { status: 404 })
  }

  const { data: updatedItem, error: itemUpdateError } = await db
    .from('market_event_items')
    .update({
      sold: false,
      sold_price_cents: null,
      sold_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', item.id)
    .eq('account_id', account.id)
    .select('*')
    .single()

  if (itemUpdateError || !updatedItem) {
    return Response.json({ error: itemUpdateError?.message ?? 'Update failed' }, { status: 500 })
  }

  const { error: objectUpdateError } = await db
    .from('wood_objects')
    .update({ status: 'for_sale', updated_at: new Date().toISOString() })
    .eq('id', item.object_id)
    .eq('account_id', account.id)

  if (objectUpdateError) {
    return Response.json(
      {
        error: `Item unmarked as sold, but failed to update the object's status: ${objectUpdateError.message}`,
      },
      { status: 500 }
    )
  }

  const [enriched] = await enrichItems(db, account.id, [updatedItem])
  return Response.json(enriched)
}

// ── Enrichment ─────────────────────────────────────────────────────────────────
//
// Denormalizes display fields from wood_objects and a signed thumbnail URL
// onto market_event_items rows, per MarketEventItemSchema, so callers never
// need a follow-up fetch. Mirrors the block in
// app/api/v1/market-events/[id]/route.ts's GET handler. Duplicated (not
// shared) across the item route files — same convention as the
// BUCKET/SIGNED_URL_EXPIRY_SECONDS constants in the photo routes.

async function enrichItems(
  db: ServiceClient,
  accountId: string,
  items: MarketEventItem[]
) {
  if (items.length === 0) return []

  const objectIds = [...new Set(items.map(i => i.object_id))]

  const { data: objects } = await db
    .from('wood_objects')
    .select('id, workshop_id, title, public_title, species')
    .eq('account_id', accountId)
    .in('id', objectIds)

  const objectById = new Map((objects ?? []).map(o => [o.id, o]))

  const { data: photos } = await db
    .from('object_photos')
    .select('object_id, storage_path, sort_order')
    .eq('account_id', accountId)
    .in('object_id', objectIds)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })

  const firstPhotoPathByObject = new Map<string, string>()
  for (const photo of photos ?? []) {
    if (!firstPhotoPathByObject.has(photo.object_id)) {
      firstPhotoPathByObject.set(photo.object_id, photo.storage_path)
    }
  }

  const signedByPath = await signPathsBatch(
    db.storage,
    BUCKET,
    [...firstPhotoPathByObject.values()],
    SIGNED_URL_EXPIRY_SECONDS
  )

  return items.map(item => {
    const obj = objectById.get(item.object_id)
    const path = firstPhotoPathByObject.get(item.object_id)
    return {
      ...item,
      workshop_id: obj?.workshop_id ?? '',
      title: obj?.title ?? null,
      public_title: obj?.public_title ?? null,
      species: obj?.species ?? null,
      thumbnail_url: path ? (signedByPath.get(path) ?? null) : null,
    }
  })
}
