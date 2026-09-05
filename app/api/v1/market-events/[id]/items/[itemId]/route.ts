import { authenticateApiRequest } from '@/lib/api-auth'
import { createServiceClient, type ServiceClient } from '@/lib/supabase/service'
import { UpdateMarketItemSchema } from '@/lib/api-schemas'
import { signPathsBatch } from '@/lib/signed-urls'
import type { MarketEventItem, MarketEventItemUpdate } from '@/lib/types'

const BUCKET = 'object-photos'
const SIGNED_URL_EXPIRY_SECONDS = 3600

// ── PATCH /api/v1/market-events/:id/items/:itemId ────────────────────────────
//
// Updates the price and/or ordering of one item on the event. Not for sold
// state — that's mark-sold/unmark-sold, which also cascade to wood_objects.

export async function PATCH(
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
    .select('id')
    .eq('id', itemId)
    .eq('market_event_id', event.id)
    .eq('account_id', account.id)
    .maybeSingle()

  if (!item) {
    return Response.json({ error: 'Item not found' }, { status: 404 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const result = UpdateMarketItemSchema.safeParse(body)
  if (!result.success) {
    return Response.json({ error: result.error.issues[0].message }, { status: 400 })
  }

  const parsed = result.data
  const payload: MarketEventItemUpdate = {}

  if (parsed.asking_price_cents !== undefined) payload.asking_price_cents = parsed.asking_price_cents
  if (parsed.sort_order !== undefined) payload.sort_order = parsed.sort_order

  payload.updated_at = new Date().toISOString()

  const { data: updated, error: updateError } = await db
    .from('market_event_items')
    .update(payload)
    .eq('id', item.id)
    .eq('account_id', account.id)
    .select('*')
    .single()

  if (updateError || !updated) {
    return Response.json({ error: updateError?.message ?? 'Update failed' }, { status: 500 })
  }

  const [enriched] = await enrichItems(db, account.id, [updated])
  return Response.json(enriched)
}

// ── DELETE /api/v1/market-events/:id/items/:itemId ───────────────────────────
//
// Removes one item from the event. Does not touch the underlying object or
// its status — this only ends the object's appearance at this event.

export async function DELETE(
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
    .select('id')
    .eq('id', itemId)
    .eq('market_event_id', event.id)
    .eq('account_id', account.id)
    .maybeSingle()

  if (!item) {
    return Response.json({ error: 'Item not found' }, { status: 404 })
  }

  const { error: deleteError } = await db
    .from('market_event_items')
    .delete()
    .eq('id', item.id)
    .eq('account_id', account.id)

  if (deleteError) {
    return Response.json({ error: deleteError.message }, { status: 500 })
  }

  return new Response(null, { status: 204 })
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
