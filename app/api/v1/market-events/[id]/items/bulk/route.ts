import { authenticateApiRequest } from '@/lib/api-auth'
import { createServiceClient, type ServiceClient } from '@/lib/supabase/service'
import { resolveObject } from '@/lib/resolve-object'
import { BulkAddMarketItemsSchema } from '@/lib/api-schemas'
import { signPathsBatch } from '@/lib/signed-urls'
import type { MarketEventItem, MarketEventItemInsert, WoodObject } from '@/lib/types'

const BUCKET = 'object-photos'
const SIGNED_URL_EXPIRY_SECONDS = 3600

// ── POST /api/v1/market-events/:id/items/bulk ────────────────────────────────
//
// Adds many objects to a market event in one call — "go through and select
// everything you're taking to this market." Skips rather than fails the whole
// batch for ids that don't resolve to this account or are already on this
// event; returns 200 (not 201 — this isn't a single created resource).

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

  const result = BulkAddMarketItemsSchema.safeParse(body)
  if (!result.success) {
    return Response.json({ error: result.error.issues[0].message }, { status: 400 })
  }

  const { object_ids } = result.data

  const { data: existingItems } = await db
    .from('market_event_items')
    .select('object_id')
    .eq('market_event_id', event.id)
    .eq('account_id', account.id)

  const seenObjectIds = new Set((existingItems ?? []).map(i => i.object_id))

  const skipped: { id: string; reason: string }[] = []
  const toInsert: { rawId: string; object: WoodObject }[] = []

  for (const rawId of object_ids) {
    const object = await resolveObject(rawId, account.id, db)
    if (!object) {
      skipped.push({ id: rawId, reason: 'Object not found' })
      continue
    }
    if (seenObjectIds.has(object.id)) {
      skipped.push({ id: rawId, reason: 'Already on this event' })
      continue
    }
    seenObjectIds.add(object.id)
    toInsert.push({ rawId, object })
  }

  // resolveObject's column list doesn't include price_cents, so batch-fetch
  // it directly to seed each new item's default asking price.
  const priceById = new Map<string, number | null>()
  if (toInsert.length > 0) {
    const { data: priceRows } = await db
      .from('wood_objects')
      .select('id, price_cents')
      .eq('account_id', account.id)
      .in('id', toInsert.map(t => t.object.id))
    for (const row of priceRows ?? []) priceById.set(row.id, row.price_cents)
  }

  const added: MarketEventItem[] = []

  for (const { rawId, object } of toInsert) {
    const payload: MarketEventItemInsert = {
      account_id: account.id,
      market_event_id: event.id,
      object_id: object.id,
      asking_price_cents: priceById.get(object.id) ?? null,
    }

    const { data: created, error: insertError } = await db
      .from('market_event_items')
      .insert(payload)
      .select('*')
      .single()

    if (insertError || !created) {
      skipped.push({ id: rawId, reason: insertError?.message ?? 'Insert failed' })
      continue
    }
    added.push(created)
  }

  const enriched = await enrichItems(db, account.id, added)
  return Response.json({ added: enriched, skipped })
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
