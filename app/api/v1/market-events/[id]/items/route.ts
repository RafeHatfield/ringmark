import { authenticateApiRequest } from '@/lib/api-auth'
import { createServiceClient, type ServiceClient } from '@/lib/supabase/service'
import { resolveObject } from '@/lib/resolve-object'
import { AddMarketItemSchema } from '@/lib/api-schemas'
import { signPathsBatch } from '@/lib/signed-urls'
import type { MarketEventItem, MarketEventItemInsert } from '@/lib/types'

const BUCKET = 'object-photos'
const SIGNED_URL_EXPIRY_SECONDS = 3600

// ── POST /api/v1/market-events/:id/items ─────────────────────────────────────
//
// Adds one object to a market event. Any object may be added regardless of
// status or publish state — a market piece doesn't need a public Ringmark
// page. asking_price_cents defaults from the object's own wood_objects.price_cents
// when omitted. object_id accepts a workshop ID or UUID (resolveObject).

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
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

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const result = AddMarketItemSchema.safeParse(body)
  if (!result.success) {
    return Response.json({ error: result.error.issues[0].message }, { status: 400 })
  }

  const { object_id, asking_price_cents } = result.data

  const object = await resolveObject(object_id, account.id, db)
  if (!object) {
    return Response.json({ error: 'Object not found' }, { status: 404 })
  }

  // resolveObject's column list doesn't include price_cents, so fetch it
  // directly when the caller didn't supply an explicit asking price.
  let price = asking_price_cents ?? null
  if (asking_price_cents === undefined) {
    const { data: priceRow } = await db
      .from('wood_objects')
      .select('price_cents')
      .eq('id', object.id)
      .eq('account_id', account.id)
      .maybeSingle()
    price = priceRow?.price_cents ?? null
  }

  const payload: MarketEventItemInsert = {
    account_id: account.id,
    market_event_id: event.id,
    object_id: object.id,
    asking_price_cents: price,
  }

  const { data: created, error: insertError } = await db
    .from('market_event_items')
    .insert(payload)
    .select('*')
    .single()

  if (insertError) {
    if (insertError.code === '23505') {
      return Response.json(
        { error: 'This object is already on this market event' },
        { status: 409 }
      )
    }
    return Response.json({ error: insertError.message }, { status: 500 })
  }
  if (!created) {
    return Response.json({ error: 'Failed to add item' }, { status: 500 })
  }

  const [enriched] = await enrichItems(db, account.id, [created])
  return Response.json(enriched, { status: 201 })
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

  // First (lowest sort_order) non-deleted photo per object, for thumbnails.
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
