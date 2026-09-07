import { authenticateApiRequest } from '@/lib/api-auth'
import { createServiceClient } from '@/lib/supabase/service'
import { PatchMarketEventSchema } from '@/lib/api-schemas'
import { signPathsBatch } from '@/lib/signed-urls'
import type { MarketEventUpdate } from '@/lib/types'

const BUCKET = 'object-photos'
const SIGNED_URL_EXPIRY_SECONDS = 3600

// ── GET /api/v1/market-events/:id ────────────────────────────────────────────
//
// Returns the event plus its item list — denormalized with object display
// fields and a signed thumbnail URL so callers never need a follow-up fetch —
// and totals, computed fresh on every request and never stored.

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const db = createServiceClient()
  const { account, error: authErr } = await authenticateApiRequest(request, db)
  if (authErr) return authErr

  const { data: event } = await db
    .from('market_events')
    .select('*')
    .eq('id', id)
    .eq('account_id', account.id)
    .maybeSingle()

  if (!event) {
    return Response.json({ error: 'Market event not found' }, { status: 404 })
  }

  const { data: itemRows, error: itemsError } = await db
    .from('market_event_items')
    .select('*')
    .eq('market_event_id', event.id)
    .eq('account_id', account.id)
    .order('sort_order', { ascending: true })

  if (itemsError) {
    return Response.json({ error: itemsError.message }, { status: 500 })
  }

  const rows = itemRows ?? []
  const objectIds = [...new Set(rows.map(r => r.object_id))]

  const { data: objects } = objectIds.length
    ? await db
        .from('wood_objects')
        .select('id, workshop_id, title, public_title, species')
        .eq('account_id', account.id)
        .in('id', objectIds)
    : { data: [] }

  const objectById = new Map((objects ?? []).map(o => [o.id, o]))

  // First (lowest sort_order) non-deleted photo per object, for thumbnails.
  // Photo deletes are soft, so this must stay filtered by deleted_at.
  const { data: photos } = objectIds.length
    ? await db
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
    db.storage,
    BUCKET,
    [...firstPhotoPathByObject.values()],
    SIGNED_URL_EXPIRY_SECONDS
  )

  const items = rows.map(item => {
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

  const totals = {
    item_count: items.length,
    sold_count: items.filter(i => i.sold).length,
    total_asking_cents: items.reduce((sum, i) => sum + (i.asking_price_cents ?? 0), 0),
    total_sold_cents: items.reduce((sum, i) => sum + (i.sold ? (i.sold_price_cents ?? 0) : 0), 0),
  }

  return Response.json({ ...event, items, totals })
}

// ── PATCH /api/v1/market-events/:id ──────────────────────────────────────────

export async function PATCH(
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

  const result = PatchMarketEventSchema.safeParse(body)
  if (!result.success) {
    return Response.json({ error: result.error.issues[0].message }, { status: 400 })
  }

  const parsed = result.data
  const payload: MarketEventUpdate = {}

  if (parsed.name !== undefined) payload.name = parsed.name
  if (parsed.event_date !== undefined) payload.event_date = parsed.event_date
  if (parsed.location_text !== undefined) payload.location_text = parsed.location_text
  if (parsed.notes !== undefined) payload.notes = parsed.notes
  if (parsed.status !== undefined) payload.status = parsed.status

  payload.updated_at = new Date().toISOString()

  // Atomic update + read-back: .select().single() returns the post-write row in
  // one round-trip and errors if 0 rows matched.
  const { data: updated, error: updateError } = await db
    .from('market_events')
    .update(payload)
    .eq('id', event.id)
    .eq('account_id', account.id)
    .select('*')
    .single()

  if (updateError || !updated) {
    return Response.json({ error: updateError?.message ?? 'Update failed' }, { status: 500 })
  }

  return Response.json(updated)
}

// ── DELETE /api/v1/market-events/:id ─────────────────────────────────────────

export async function DELETE(
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

  // market_event_items.market_event_id cascades at the DB level — no photos,
  // no storage to sweep, unlike object deletion.
  const { error: deleteError } = await db
    .from('market_events')
    .delete()
    .eq('id', event.id)
    .eq('account_id', account.id)

  if (deleteError) {
    return Response.json({ error: deleteError.message }, { status: 500 })
  }

  return new Response(null, { status: 204 })
}
