'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getOrCreateAccount } from '@/lib/supabase/account'
import type { MarketEventStatus, MarketEventUpdate } from '@/lib/types'

export type CreateMarketEventData = {
  name: string
  event_date?: string | null
  location_text?: string | null
  notes?: string | null
}

export async function createMarketEvent(
  data: CreateMarketEventData
): Promise<{ error?: string; id?: string }> {
  const supabase = await createClient()
  const account = await getOrCreateAccount()

  const name = data.name.trim()
  if (!name) return { error: 'Name is required.' }

  const { data: created, error } = await supabase
    .from('market_events')
    .insert({
      account_id: account.id,
      name,
      event_date: data.event_date || null,
      location_text: data.location_text?.trim() || null,
      notes: data.notes?.trim() || null,
    })
    .select('id')
    .single()

  if (error || !created) return { error: error?.message ?? 'Failed to create market event.' }

  revalidatePath('/markets')
  return { id: created.id }
}

export type UpdateMarketEventData = Partial<{
  name: string
  event_date: string | null
  location_text: string | null
  notes: string | null
  status: MarketEventStatus
}>

export async function updateMarketEvent(
  id: string,
  data: UpdateMarketEventData
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const account = await getOrCreateAccount()

  const { data: existing } = await supabase
    .from('market_events')
    .select('id')
    .eq('id', id)
    .eq('account_id', account.id)
    .single()

  if (!existing) return { error: 'Market event not found.' }

  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (data.name !== undefined) {
    const name = data.name.trim()
    if (!name) return { error: 'Name is required.' }
    payload.name = name
  }
  if (data.event_date !== undefined) payload.event_date = data.event_date || null
  if (data.location_text !== undefined) payload.location_text = data.location_text?.trim() || null
  if (data.notes !== undefined) payload.notes = data.notes?.trim() || null
  if (data.status !== undefined) payload.status = data.status

  const { error } = await supabase
    .from('market_events')
    .update(payload as MarketEventUpdate)
    .eq('id', id)
    .eq('account_id', account.id)

  if (error) return { error: error.message }

  revalidatePath('/markets')
  revalidatePath(`/markets/${id}`)
  return {}
}

/**
 * Deletes a market event. Its items cascade at the DB level
 * (market_event_items.market_event_id references market_events(id) on delete
 * cascade) — no photos, no storage, unlike object deletion.
 */
export async function deleteMarketEvent(id: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const account = await getOrCreateAccount()

  const { data: existing } = await supabase
    .from('market_events')
    .select('id')
    .eq('id', id)
    .eq('account_id', account.id)
    .single()

  if (!existing) return { error: 'Market event not found.' }

  const { error } = await supabase
    .from('market_events')
    .delete()
    .eq('id', id)
    .eq('account_id', account.id)

  if (error) return { error: error.message }

  revalidatePath('/markets')
  return {}
}

export async function addMarketItem(
  marketEventId: string,
  objectId: string,
  askingPriceCents?: number | null
): Promise<{ error?: string; id?: string }> {
  const supabase = await createClient()
  const account = await getOrCreateAccount()

  const { data: event } = await supabase
    .from('market_events')
    .select('id')
    .eq('id', marketEventId)
    .eq('account_id', account.id)
    .single()

  if (!event) return { error: 'Market event not found.' }

  const { data: object } = await supabase
    .from('wood_objects')
    .select('id, price_cents')
    .eq('id', objectId)
    .eq('account_id', account.id)
    .single()

  if (!object) return { error: 'Object not found.' }

  const { data: existingItem } = await supabase
    .from('market_event_items')
    .select('id')
    .eq('market_event_id', marketEventId)
    .eq('object_id', objectId)
    .eq('account_id', account.id)
    .maybeSingle()

  if (existingItem) return { error: 'This piece is already on this market event.' }

  const { data: last } = await supabase
    .from('market_event_items')
    .select('sort_order')
    .eq('market_event_id', marketEventId)
    .eq('account_id', account.id)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextOrder = (last?.sort_order ?? -1) + 1

  const { data: created, error } = await supabase
    .from('market_event_items')
    .insert({
      account_id: account.id,
      market_event_id: marketEventId,
      object_id: objectId,
      asking_price_cents: askingPriceCents ?? object.price_cents ?? null,
      sort_order: nextOrder,
    })
    .select('id')
    .single()

  if (error || !created) return { error: error?.message ?? 'Failed to add item.' }

  revalidatePath(`/markets/${marketEventId}`)
  return { id: created.id }
}

/**
 * Bulk-adds objects to a market event. Silently skips (doesn't fail the
 * batch) objects that don't resolve to this account or are already on the
 * event — matches the REST API's bulk-add behaviour (Task 1.3).
 */
export async function addMarketItemsBulk(
  marketEventId: string,
  objectIds: string[]
): Promise<{ error?: string; added?: number; skipped?: number }> {
  const supabase = await createClient()
  const account = await getOrCreateAccount()

  const { data: event } = await supabase
    .from('market_events')
    .select('id')
    .eq('id', marketEventId)
    .eq('account_id', account.id)
    .single()

  if (!event) return { error: 'Market event not found.' }

  const uniqueIds = [...new Set(objectIds)]
  if (uniqueIds.length === 0) return { added: 0, skipped: 0 }

  const { data: objects } = await supabase
    .from('wood_objects')
    .select('id, price_cents')
    .eq('account_id', account.id)
    .in('id', uniqueIds)

  const { data: existingItems } = await supabase
    .from('market_event_items')
    .select('object_id, sort_order')
    .eq('market_event_id', marketEventId)
    .eq('account_id', account.id)

  const existingObjectIds = new Set((existingItems ?? []).map((i) => i.object_id))
  const objectsById = new Map((objects ?? []).map((o) => [o.id, o]))

  let nextOrder =
    (existingItems ?? []).reduce((max, i) => Math.max(max, i.sort_order), -1) + 1

  const rows = uniqueIds
    .filter((id) => objectsById.has(id) && !existingObjectIds.has(id))
    .map((id) => {
      const object = objectsById.get(id)!
      return {
        account_id: account.id,
        market_event_id: marketEventId,
        object_id: id,
        asking_price_cents: object.price_cents ?? null,
        sort_order: nextOrder++,
      }
    })

  const skipped = uniqueIds.length - rows.length

  if (rows.length === 0) return { added: 0, skipped }

  const { data: inserted, error } = await supabase
    .from('market_event_items')
    .insert(rows)
    .select('id')

  if (error) return { error: error.message }

  revalidatePath(`/markets/${marketEventId}`)
  return { added: inserted?.length ?? 0, skipped }
}

export async function updateMarketItemPrice(
  itemId: string,
  askingPriceCents: number | null
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const account = await getOrCreateAccount()

  const { data: item } = await supabase
    .from('market_event_items')
    .select('id, market_event_id')
    .eq('id', itemId)
    .eq('account_id', account.id)
    .single()

  if (!item) return { error: 'Item not found.' }

  const { error } = await supabase
    .from('market_event_items')
    .update({ asking_price_cents: askingPriceCents, updated_at: new Date().toISOString() })
    .eq('id', itemId)
    .eq('account_id', account.id)

  if (error) return { error: error.message }

  revalidatePath(`/markets/${item.market_event_id}`)
  return {}
}

export async function removeMarketItem(itemId: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const account = await getOrCreateAccount()

  const { data: item } = await supabase
    .from('market_event_items')
    .select('id, market_event_id')
    .eq('id', itemId)
    .eq('account_id', account.id)
    .single()

  if (!item) return { error: 'Item not found.' }

  const { error } = await supabase
    .from('market_event_items')
    .delete()
    .eq('id', itemId)
    .eq('account_id', account.id)

  if (error) return { error: error.message }

  revalidatePath(`/markets/${item.market_event_id}`)
  return {}
}

/**
 * Marks an item sold, and — in the same call — flips the underlying
 * object's status to 'sold' (scoped to account_id). This is the one place
 * Market Mode reaches outside its own tables; done explicitly here as two
 * scoped updates rather than a DB trigger, matching how root_id cascade on
 * re-parent is handled in actions/objects.ts.
 */
export async function markItemSold(
  itemId: string,
  soldPriceCents?: number | null
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const account = await getOrCreateAccount()

  const { data: item } = await supabase
    .from('market_event_items')
    .select('id, market_event_id, object_id, asking_price_cents')
    .eq('id', itemId)
    .eq('account_id', account.id)
    .single()

  if (!item) return { error: 'Item not found.' }

  const resolvedSoldPrice = soldPriceCents ?? item.asking_price_cents ?? null

  const { error } = await supabase
    .from('market_event_items')
    .update({
      sold: true,
      sold_price_cents: resolvedSoldPrice,
      sold_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', itemId)
    .eq('account_id', account.id)

  if (error) return { error: error.message }

  await supabase
    .from('wood_objects')
    .update({ status: 'sold', updated_at: new Date().toISOString() })
    .eq('id', item.object_id)
    .eq('account_id', account.id)

  revalidatePath(`/markets/${item.market_event_id}`)
  revalidatePath(`/objects/${item.object_id}`)
  return {}
}

/**
 * Reverts an item to unsold, and unconditionally reverts the underlying
 * object's status to 'for_sale' — not whatever it was before. Deliberate:
 * an object added to a market event was almost certainly for_sale
 * beforehand, and this avoids a redundant "previous status" column.
 */
export async function unmarkItemSold(itemId: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const account = await getOrCreateAccount()

  const { data: item } = await supabase
    .from('market_event_items')
    .select('id, market_event_id, object_id')
    .eq('id', itemId)
    .eq('account_id', account.id)
    .single()

  if (!item) return { error: 'Item not found.' }

  const { error } = await supabase
    .from('market_event_items')
    .update({
      sold: false,
      sold_price_cents: null,
      sold_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', itemId)
    .eq('account_id', account.id)

  if (error) return { error: error.message }

  await supabase
    .from('wood_objects')
    .update({ status: 'for_sale', updated_at: new Date().toISOString() })
    .eq('id', item.object_id)
    .eq('account_id', account.id)

  revalidatePath(`/markets/${item.market_event_id}`)
  revalidatePath(`/objects/${item.object_id}`)
  return {}
}
