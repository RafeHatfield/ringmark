import { authenticateApiRequest } from '@/lib/api-auth'
import { createServiceClient, type ServiceClient } from '@/lib/supabase/service'
import { MarkSoldSchema } from '@/lib/api-schemas'
import { signPathsBatch } from '@/lib/signed-urls'
import type { MarketEventItem } from '@/lib/types'

const BUCKET = 'object-photos'
const SIGNED_URL_EXPIRY_SECONDS = 3600

// ── POST /api/v1/market-events/:id/items/:itemId/mark-sold ───────────────────
//
// Records the sale on the market_event_items row AND flips the underlying
// wood_objects.status to 'sold', scoped to this account. This is the one
// place Market Mode reaches outside its own tables — done explicitly here as
// two scoped updates, not a DB trigger, matching how the root_id cascade on
// re-parent is handled in application code (actions/objects.ts) rather than
// in the database.
//
// sold_price_cents defaults to the item's current asking_price_cents when
// the body omits it — "sold at asking" is the common case.

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

  // Body is optional — an empty POST means "sold at asking".
  let body: unknown = {}
  const rawBody = await request.text()
  if (rawBody) {
    try {
      body = JSON.parse(rawBody)
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
  }

  const result = MarkSoldSchema.safeParse(body)
  if (!result.success) {
    return Response.json({ error: result.error.issues[0].message }, { status: 400 })
  }

  const soldPriceCents = result.data.sold_price_cents ?? item.asking_price_cents

  const { data: updatedItem, error: itemUpdateError } = await db
    .from('market_event_items')
    .update({
      sold: true,
      sold_price_cents: soldPriceCents,
      sold_at: new Date().toISOString(),
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
    .update({ status: 'sold', updated_at: new Date().toISOString() })
    .eq('id', item.object_id)
    .eq('account_id', account.id)

  if (objectUpdateError) {
    return Response.json(
      {
        error: `Item marked sold, but failed to update the object's status: ${objectUpdateError.message}`,
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
