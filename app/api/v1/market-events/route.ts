import { authenticateApiRequest } from '@/lib/api-auth'
import { createServiceClient } from '@/lib/supabase/service'
import { CreateMarketEventSchema } from '@/lib/api-schemas'
import type { MarketEventInsert, MarketEventStatus } from '@/lib/types'

// ── GET /api/v1/market-events ────────────────────────────────────────────────
//
// Lists this account's market events, optionally filtered by ?status=. Most
// recent event_date first (events without a date fixed yet sort last, ordered
// by created_at).

export async function GET(request: Request) {
  const db = createServiceClient()
  const { account, error: authErr } = await authenticateApiRequest(request, db)
  if (authErr) return authErr

  const url = new URL(request.url)
  const status = url.searchParams.get('status') ?? undefined

  let query = db
    .from('market_events')
    .select('*', { count: 'exact' })
    .eq('account_id', account.id)
    .order('event_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (status) query = query.eq('status', status as MarketEventStatus)

  const { data, error, count } = await query

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ data: data ?? [], total: count ?? 0 })
}

// ── POST /api/v1/market-events ───────────────────────────────────────────────
//
// Always creates in 'planning' status — CreateMarketEventSchema has no status
// field, so there is nothing for a caller to override here.

export async function POST(request: Request) {
  const db = createServiceClient()
  const { account, error: authErr } = await authenticateApiRequest(request, db)
  if (authErr) return authErr

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const result = CreateMarketEventSchema.safeParse(body)
  if (!result.success) {
    return Response.json({ error: result.error.issues[0].message }, { status: 400 })
  }

  const { name, event_date, location_text, notes } = result.data

  const payload: MarketEventInsert = {
    account_id: account.id,
    name: name.trim(),
    event_date: event_date || null,
    location_text: location_text?.trim() || null,
    notes: notes?.trim() || null,
    status: 'planning',
  }

  const { data: created, error: insertError } = await db
    .from('market_events')
    .insert(payload)
    .select('*')
    .single()

  if (insertError || !created) {
    return Response.json(
      { error: insertError?.message ?? 'Failed to create market event' },
      { status: 500 }
    )
  }

  return Response.json(created, { status: 201 })
}
