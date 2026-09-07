/**
 * Market Events REST API — end-to-end lifecycle + cross-account isolation.
 *
 * NOT YET RUNNABLE: `market_events` and `market_event_items` exist only as a
 * migration file (supabase/migrations/20260805000002_market_mode.sql) that has
 * not been applied to any database — `supabase db push` is a production schema
 * change and needs explicit sign-off, same as every prior migration in this
 * project. Every request in this file will fail (relation does not exist)
 * until that migration lands. This spec is written and reviewed against the
 * contract in lib/api-spec.ts / lib/api-schemas.ts / docs/api.md, but it has
 * never been executed — do not read a green run history into this file.
 *
 * Covers, in order: event creation, ?status= filtering, event-level PATCH,
 * single item add (price default from the object), duplicate single add
 * (409), bulk add ({added, skipped} shape, dupe + garbage both skipped, 200
 * not 201), GET totals + denormalized item display fields, item price PATCH,
 * mark-sold (item state AND the wood_objects.status cascade — the most
 * important assertion in the file), unmark-sold (reverts to 'for_sale'
 * unconditionally, not the pre-sale status), item removal, event deletion
 * (with a direct DB check that items actually cascade, not just become
 * unreachable through the API), a handful of validation/not-found edge
 * cases, and cross-account isolation (a second account's key must 404, not
 * 403 or 200, on every operation against the first account's event).
 *
 * Uses the REST API for all setup — no browser/UI interaction needed. Follows
 * the RUN_TAG + best-effort try/catch cleanup pattern from e2e/api.spec.ts
 * and the cross-account fixture pattern from e2e/security-cross-account.spec.ts.
 */

import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import {
  ensureSecondTestUser,
  getAccountIdForUser,
  createTestApiKey,
} from './helpers/supabase-admin'

function apiHeaders(key = process.env.RINGMARK_API_KEY ?? '') {
  return {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  }
}

/** Service-role client, used only to verify the DB-level cascade on event delete
 *  and to clean up the throwaway API key created for the cross-account suite. */
function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

// Unique suffix per test run — avoids workshop ID / event name collisions between runs
const RUN_TAG = `MKT${Date.now()}`

type ObjFixture = { id: string; workshop_id: string }

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Market Events lifecycle', () => {
  // Track everything created here so afterAll can sweep it up even if a test
  // fails partway through the ordered lifecycle below.
  const createdObjectIds: string[] = []

  let eventId = ''
  let objA: ObjFixture = { id: '', workshop_id: '' } // price_cents 15000, status 'finished' — the single-add + mark-sold subject
  let objC: ObjFixture = { id: '', workshop_id: '' } // price_cents 5000 — bulk-add subject
  let objD: ObjFixture = { id: '', workshop_id: '' } // no price — bulk-add subject, exercises null default

  let itemAId = '' // objA's market_event_items row id

  test.beforeAll(async ({ request }) => {
    const h = apiHeaders()

    const create = await request.post('/api/v1/market-events', {
      headers: h,
      data: {
        name: `Lifecycle Test Market ${RUN_TAG}`,
        event_date: '2026-09-12',
        location_text: 'Test Fairgrounds',
        notes: 'created by e2e/market-events.spec.ts',
      },
    })
    expect(create.status()).toBe(201)
    const event = await create.json()
    eventId = event.id
    expect(event.status).toBe('planning') // CreateMarketEventSchema has no status field
    expect(event.name).toBe(`Lifecycle Test Market ${RUN_TAG}`)

    const mkObject = async (
      suffix: string,
      priceCents: number | null,
      status = 'finished',
    ): Promise<ObjFixture> => {
      const r = await request.post('/api/v1/objects', {
        headers: h,
        data: {
          object_type: 'finished_bowl',
          workshop_id: `${RUN_TAG}${suffix}`,
          title: `Market fixture ${suffix}`,
          status,
          price_cents: priceCents,
        },
      })
      expect(r.status()).toBe(201)
      const obj = await r.json()
      createdObjectIds.push(obj.id)
      return { id: obj.id as string, workshop_id: obj.workshop_id as string }
    }

    objA = await mkObject('A', 15000, 'finished')
    objC = await mkObject('C', 5000)
    objD = await mkObject('D', null)
  })

  test.afterAll(async ({ request }) => {
    const h = apiHeaders()
    // Best-effort: the event may already be gone (deleted in the lifecycle
    // itself), and objects may already be gone too — 404s here are fine.
    try {
      if (eventId) await request.delete(`/api/v1/market-events/${eventId}`, { headers: h })
    } catch { /* cleanup is best-effort */ }
    for (const id of createdObjectIds) {
      try {
        await request.delete(`/api/v1/objects/${id}?force=true`, { headers: h })
      } catch { /* cleanup is best-effort */ }
    }
  })

  // ── ?status= filter ──────────────────────────────────────────────────────

  test('GET market-events — ?status=planning includes the fixture, ?status=completed excludes it', async ({ request }) => {
    const planning = await request.get('/api/v1/market-events?status=planning', { headers: apiHeaders() })
    expect(planning.status()).toBe(200)
    const planningBody = await planning.json()
    expect(planningBody).toHaveProperty('data')
    expect(planningBody).toHaveProperty('total')
    const planningIds = planningBody.data.map((e: { id: string }) => e.id)
    expect(planningIds).toContain(eventId)
    for (const e of planningBody.data) expect(e.status).toBe('planning')

    const completed = await request.get('/api/v1/market-events?status=completed', { headers: apiHeaders() })
    expect(completed.status()).toBe(200)
    const completedBody = await completed.json()
    const completedIds = completedBody.data.map((e: { id: string }) => e.id)
    expect(completedIds).not.toContain(eventId)
  })

  // ── Event-level PATCH ────────────────────────────────────────────────────

  test('PATCH event — updates name/location/notes and transitions status to "active"', async ({ request }) => {
    const r = await request.patch(`/api/v1/market-events/${eventId}`, {
      headers: apiHeaders(),
      data: {
        name: `Lifecycle Test Market ${RUN_TAG} (renamed)`,
        location_text: 'Renamed Fairgrounds',
        status: 'active',
      },
    })
    expect(r.status()).toBe(200)
    const event = await r.json()
    expect(event.id).toBe(eventId)
    expect(event.name).toBe(`Lifecycle Test Market ${RUN_TAG} (renamed)`)
    expect(event.location_text).toBe('Renamed Fairgrounds')
    expect(event.status).toBe('active')
  })

  // ── 2. Add one item singly — asking_price_cents defaults from the object ──

  test('POST items — single add defaults asking_price_cents from the object price_cents', async ({ request }) => {
    const r = await request.post(`/api/v1/market-events/${eventId}/items`, {
      headers: apiHeaders(),
      // Pass the workshop ID (not the UUID) to exercise resolveObject's non-UUID path
      data: { object_id: objA.workshop_id },
    })
    expect(r.status()).toBe(201)
    const item = await r.json()
    expect(item.market_event_id).toBe(eventId)
    expect(item.object_id).toBe(objA.id)
    expect(item.asking_price_cents).toBe(15000) // defaulted — no asking_price_cents was sent
    expect(item.sold).toBe(false)
    expect(item.sold_price_cents).toBeNull()
    expect(item.sold_at).toBeNull()
    // Denormalized display fields — no follow-up fetch should be needed
    expect(item.workshop_id).toBe(objA.workshop_id)
    expect(item.title).toBe('Market fixture A')
    expect(item).toHaveProperty('species')
    expect('thumbnail_url' in item).toBe(true)
    itemAId = item.id
  })

  // ── 3. Duplicate single add → 409 ──────────────────────────────────────────

  test('POST items — adding the same object again → 409', async ({ request }) => {
    const r = await request.post(`/api/v1/market-events/${eventId}/items`, {
      headers: apiHeaders(),
      data: { object_id: objA.id }, // UUID this time — both forms must collide
    })
    expect(r.status()).toBe(409)
    const body = await r.json()
    expect(body).toHaveProperty('error')
    expect(body.error).toMatch(/already/i)
  })

  // ── 4. Bulk add — {added, skipped} shape, 200 not 201 ──────────────────────

  test('POST items/bulk — adds new objects, 200 not 201, skips the duplicate and a garbage id (not a batch failure)', async ({ request }) => {
    const garbageId = `${RUN_TAG}-DOES-NOT-EXIST`
    const r = await request.post(`/api/v1/market-events/${eventId}/items/bulk`, {
      headers: apiHeaders(),
      data: { object_ids: [objC.id, objD.id, objA.id, garbageId] },
    })
    expect(r.status()).toBe(200) // not 201 — this isn't a single created resource
    const body = await r.json()
    expect(body).toHaveProperty('added')
    expect(body).toHaveProperty('skipped')
    expect(Array.isArray(body.added)).toBe(true)
    expect(Array.isArray(body.skipped)).toBe(true)
    expect(body.added.length).toBe(2)
    expect(body.skipped.length).toBe(2)

    const addedObjectIds = body.added.map((i: { object_id: string }) => i.object_id)
    expect(addedObjectIds).toContain(objC.id)
    expect(addedObjectIds).toContain(objD.id)
    expect(addedObjectIds).not.toContain(objA.id) // already on the event — must not be re-added

    const skippedIds = body.skipped.map((s: { id: string }) => s.id)
    expect(skippedIds).toContain(objA.id)
    expect(skippedIds).toContain(garbageId)

    const dupeEntry = body.skipped.find((s: { id: string; reason: string }) => s.id === objA.id)
    expect(dupeEntry.reason).toMatch(/already/i)
    const garbageEntry = body.skipped.find((s: { id: string; reason: string }) => s.id === garbageId)
    expect(garbageEntry.reason).toMatch(/not found/i)

    // Bulk-added items also carry the denormalized fields, and pick up the
    // right default price per-object (5000 vs null) — not one shared default.
    const addedC = body.added.find((i: { object_id: string }) => i.object_id === objC.id)
    expect(addedC.asking_price_cents).toBe(5000)
    expect(addedC.workshop_id).toBe(objC.workshop_id)
    const addedD = body.added.find((i: { object_id: string }) => i.object_id === objD.id)
    expect(addedD.asking_price_cents).toBeNull()
  })

  // ── 5. GET event — totals + denormalized item display fields ──────────────

  test('GET event — totals reflect all three items, items carry display fields', async ({ request }) => {
    const r = await request.get(`/api/v1/market-events/${eventId}`, { headers: apiHeaders() })
    expect(r.status()).toBe(200)
    const body = await r.json()
    expect(body.id).toBe(eventId)
    expect(Array.isArray(body.items)).toBe(true)
    expect(body.items.length).toBe(3)

    expect(body.totals).toEqual({
      item_count: 3,
      sold_count: 0,
      total_asking_cents: 20000, // 15000 (A) + 5000 (C) + 0 (D, null price)
      total_sold_cents: 0,
    })

    for (const item of body.items) {
      expect(item).toHaveProperty('id')
      expect(item).toHaveProperty('workshop_id')
      expect(item).toHaveProperty('title')
      expect(item).toHaveProperty('species')
      expect('thumbnail_url' in item).toBe(true) // null is fine — no photos on these fixtures
    }
  })

  // ── 6. PATCH an item's asking price ────────────────────────────────────────

  test('PATCH item — updates asking_price_cents and totals reflect it on re-fetch', async ({ request }) => {
    const r = await request.patch(`/api/v1/market-events/${eventId}/items/${itemAId}`, {
      headers: apiHeaders(),
      data: { asking_price_cents: 25000 },
    })
    expect(r.status()).toBe(200)
    const item = await r.json()
    expect(item.id).toBe(itemAId)
    expect(item.asking_price_cents).toBe(25000)

    const eventR = await request.get(`/api/v1/market-events/${eventId}`, { headers: apiHeaders() })
    const event = await eventR.json()
    expect(event.totals.total_asking_cents).toBe(30000) // 25000 (A, patched) + 5000 (C) + 0 (D)
  })

  // ── 7. mark-sold — item state AND the object status cascade ───────────────

  test('mark-sold — item flips to sold and the underlying object status becomes "sold"', async ({ request }) => {
    // No body — "sold at asking" is the default, and this is the shape the
    // live one-tap mobile UI actually sends (no confirmation dialog).
    const r = await request.post(`/api/v1/market-events/${eventId}/items/${itemAId}/mark-sold`, {
      headers: apiHeaders(),
    })
    expect(r.status()).toBe(200)
    const item = await r.json()
    expect(item.sold).toBe(true)
    expect(item.sold_price_cents).toBe(25000) // defaulted from the current asking_price_cents
    expect(item.sold_at).toBeTruthy()

    // The most important assertion in this file: the cross-table status cascade.
    const objR = await request.get(`/api/v1/objects/${objA.id}`, { headers: apiHeaders() })
    expect(objR.status()).toBe(200)
    const obj = await objR.json()
    expect(obj.status).toBe('sold')

    const eventR = await request.get(`/api/v1/market-events/${eventId}`, { headers: apiHeaders() })
    const event = await eventR.json()
    expect(event.totals.sold_count).toBe(1)
    expect(event.totals.total_sold_cents).toBe(25000)
  })

  test('mark-sold — an explicit sold_price_cents overrides the asking price (haggled sale)', async ({ request }) => {
    // objC has never been marked sold — use it to test the override branch
    // independently of the objA/itemAId state the rest of the file depends on.
    const eventR = await request.get(`/api/v1/market-events/${eventId}`, { headers: apiHeaders() })
    const event = await eventR.json()
    const itemC = event.items.find((i: { object_id: string }) => i.object_id === objC.id)
    expect(itemC).toBeTruthy()

    const r = await request.post(`/api/v1/market-events/${eventId}/items/${itemC.id}/mark-sold`, {
      headers: apiHeaders(),
      data: { sold_price_cents: 4000 }, // haggled down from the 5000 asking price
    })
    expect(r.status()).toBe(200)
    const item = await r.json()
    expect(item.sold).toBe(true)
    expect(item.sold_price_cents).toBe(4000)
    expect(item.asking_price_cents).toBe(5000) // asking price itself is untouched

    // Revert immediately so it doesn't perturb later totals assertions.
    const un = await request.post(`/api/v1/market-events/${eventId}/items/${itemC.id}/unmark-sold`, {
      headers: apiHeaders(),
    })
    expect(un.status()).toBe(200)
  })

  // ── 8. unmark-sold — reverts item and object status ────────────────────────

  test('unmark-sold — clears sold state and reverts the object status to "for_sale" (not the pre-sale status)', async ({ request }) => {
    const r = await request.post(`/api/v1/market-events/${eventId}/items/${itemAId}/unmark-sold`, {
      headers: apiHeaders(),
    })
    expect(r.status()).toBe(200)
    const item = await r.json()
    expect(item.sold).toBe(false)
    expect(item.sold_price_cents).toBeNull()
    expect(item.sold_at).toBeNull()

    const objR = await request.get(`/api/v1/objects/${objA.id}`, { headers: apiHeaders() })
    const obj = await objR.json()
    // objA started as 'finished' — unconditional revert to 'for_sale' proves
    // this does NOT restore the pre-sale status (documented, intentional).
    expect(obj.status).toBe('for_sale')

    const eventR = await request.get(`/api/v1/market-events/${eventId}`, { headers: apiHeaders() })
    const event = await eventR.json()
    expect(event.totals.sold_count).toBe(0)
    expect(event.totals.total_sold_cents).toBe(0)
  })

  // ── 9. Remove an item ───────────────────────────────────────────────────────

  test('DELETE item — 204, gone from the event, object status left untouched', async ({ request }) => {
    const del = await request.delete(`/api/v1/market-events/${eventId}/items/${itemAId}`, {
      headers: apiHeaders(),
    })
    expect(del.status()).toBe(204)
    expect(await del.text()).toBe('')

    const eventR = await request.get(`/api/v1/market-events/${eventId}`, { headers: apiHeaders() })
    const event = await eventR.json()
    const ids = event.items.map((i: { id: string }) => i.id)
    expect(ids).not.toContain(itemAId)
    expect(event.totals.item_count).toBe(2)

    // Removing an item is not the same as unmark-sold — it must not touch the object.
    const objR = await request.get(`/api/v1/objects/${objA.id}`, { headers: apiHeaders() })
    expect((await objR.json()).status).toBe('for_sale')
  })

  test('DELETE item again → 404', async ({ request }) => {
    const del = await request.delete(`/api/v1/market-events/${eventId}/items/${itemAId}`, {
      headers: apiHeaders(),
    })
    expect(del.status()).toBe(404)
  })

  // ── 10. Delete the event — cascade + subsequent 404 ─────────────────────────

  test('DELETE event — 204, items cascade at the DB level, subsequent GET → 404', async ({ request }) => {
    const del = await request.delete(`/api/v1/market-events/${eventId}`, { headers: apiHeaders() })
    expect(del.status()).toBe(204)
    expect(await del.text()).toBe('')

    const getR = await request.get(`/api/v1/market-events/${eventId}`, { headers: apiHeaders() })
    expect(getR.status()).toBe(404)

    // Confirm the FK cascade actually removed the join rows at the DB level,
    // not merely that the API stopped exposing them.
    const { data: remaining, error } = await admin()
      .from('market_event_items')
      .select('id')
      .eq('market_event_id', eventId)
    expect(error).toBeNull()
    expect(remaining ?? []).toHaveLength(0)

    eventId = '' // tell afterAll not to try deleting it again
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Validation / not-found edge cases
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Market Events — validation and not-found', () => {
  let eventId = ''
  let objId = ''

  test.beforeAll(async ({ request }) => {
    const h = apiHeaders()
    const evR = await request.post('/api/v1/market-events', {
      headers: h,
      data: { name: `Validation Fixture ${RUN_TAG}` },
    })
    expect(evR.status()).toBe(201)
    eventId = (await evR.json()).id

    const objR = await request.post('/api/v1/objects', {
      headers: h,
      data: { object_type: 'source', workshop_id: `${RUN_TAG}VAL` },
    })
    expect(objR.status()).toBe(201)
    objId = (await objR.json()).id
  })

  test.afterAll(async ({ request }) => {
    const h = apiHeaders()
    try { if (eventId) await request.delete(`/api/v1/market-events/${eventId}`, { headers: h }) } catch { /* best effort */ }
    try { if (objId) await request.delete(`/api/v1/objects/${objId}?force=true`, { headers: h }) } catch { /* best effort */ }
  })

  test('POST market-events — missing name → 400', async ({ request }) => {
    const r = await request.post('/api/v1/market-events', {
      headers: apiHeaders(),
      data: { location_text: 'Somewhere' },
    })
    expect(r.status()).toBe(400)
    const body = await r.json()
    expect(body).toHaveProperty('error')
  })

  test('GET market-events without auth → 401', async ({ request }) => {
    const r = await request.get('/api/v1/market-events')
    expect(r.status()).toBe(401)
  })

  test('GET unknown event id → 404', async ({ request }) => {
    const r = await request.get('/api/v1/market-events/00000000-0000-0000-0000-000000000000', {
      headers: apiHeaders(),
    })
    expect(r.status()).toBe(404)
  })

  test('PATCH unknown event id → 404', async ({ request }) => {
    const r = await request.patch('/api/v1/market-events/00000000-0000-0000-0000-000000000000', {
      headers: apiHeaders(),
      data: { name: 'ghost update' },
    })
    expect(r.status()).toBe(404)
  })

  test('DELETE unknown event id → 404', async ({ request }) => {
    const r = await request.delete('/api/v1/market-events/00000000-0000-0000-0000-000000000000', {
      headers: apiHeaders(),
    })
    expect(r.status()).toBe(404)
  })

  test('POST items — garbage object_id → 404', async ({ request }) => {
    const r = await request.post(`/api/v1/market-events/${eventId}/items`, {
      headers: apiHeaders(),
      data: { object_id: `${RUN_TAG}-GARBAGE-NOPE` },
    })
    expect(r.status()).toBe(404)
    const body = await r.json()
    expect(body).toHaveProperty('error')
  })

  test('POST items — into an unknown event id → 404', async ({ request }) => {
    const r = await request.post(
      '/api/v1/market-events/00000000-0000-0000-0000-000000000000/items',
      { headers: apiHeaders(), data: { object_id: objId } },
    )
    expect(r.status()).toBe(404)
  })

  test('PATCH unknown item id → 404', async ({ request }) => {
    const r = await request.patch(
      `/api/v1/market-events/${eventId}/items/00000000-0000-0000-0000-000000000000`,
      { headers: apiHeaders(), data: { asking_price_cents: 1000 } },
    )
    expect(r.status()).toBe(404)
  })

  test('mark-sold on unknown item id → 404', async ({ request }) => {
    const r = await request.post(
      `/api/v1/market-events/${eventId}/items/00000000-0000-0000-0000-000000000000/mark-sold`,
      { headers: apiHeaders() },
    )
    expect(r.status()).toBe(404)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Cross-account isolation
// ─────────────────────────────────────────────────────────────────────────────
//
// A second account's API key must get 404 — auth succeeded, resource just
// isn't in that account — on every operation against the first account's
// event. Never 403 (would leak existence) and never 200 (would leak data).

test.describe('Market Events — cross-account isolation', () => {
  let otherKey = ''
  let otherKeyId = ''
  let eventId = ''
  let objId = ''

  function bHeaders() {
    return { Authorization: `Bearer ${otherKey}`, 'Content-Type': 'application/json' }
  }

  test.beforeAll(async ({ request }) => {
    const userBId = await ensureSecondTestUser()
    const accountBId = await getAccountIdForUser(userBId)
    const key = await createTestApiKey(userBId, accountBId, 'market-events isolation key')
    otherKey = key.rawKey
    otherKeyId = key.keyId

    const h = apiHeaders() // Account A's key (RINGMARK_API_KEY)
    const evR = await request.post('/api/v1/market-events', {
      headers: h,
      data: { name: `Isolation Fixture ${RUN_TAG}` },
    })
    expect(evR.status()).toBe(201)
    eventId = (await evR.json()).id

    const objR = await request.post('/api/v1/objects', {
      headers: h,
      data: { object_type: 'source', workshop_id: `${RUN_TAG}ISO` },
    })
    expect(objR.status()).toBe(201)
    objId = (await objR.json()).id
  })

  test.afterAll(async ({ request }) => {
    const h = apiHeaders()
    try { if (eventId) await request.delete(`/api/v1/market-events/${eventId}`, { headers: h }) } catch { /* best effort */ }
    try { if (objId) await request.delete(`/api/v1/objects/${objId}?force=true`, { headers: h }) } catch { /* best effort */ }
    try { if (otherKeyId) await admin().from('api_keys').delete().eq('id', otherKeyId) } catch { /* best effort */ }
  })

  test("B's key against A's event — GET → 404 (not 403, not 200)", async ({ request }) => {
    const r = await request.get(`/api/v1/market-events/${eventId}`, { headers: bHeaders() })
    expect(r.status()).toBe(404)
    const body = await r.json()
    expect(body).toHaveProperty('error')
  })

  test("B's key against A's event — PATCH → 404, event unchanged for A", async ({ request }) => {
    const r = await request.patch(`/api/v1/market-events/${eventId}`, {
      headers: bHeaders(),
      data: { name: 'should not work' },
    })
    expect(r.status()).toBe(404)

    const check = await request.get(`/api/v1/market-events/${eventId}`, { headers: apiHeaders() })
    const event = await check.json()
    expect(event.name).toBe(`Isolation Fixture ${RUN_TAG}`)
  })

  test("B's key against A's event — DELETE → 404, event still exists for A", async ({ request }) => {
    const r = await request.delete(`/api/v1/market-events/${eventId}`, { headers: bHeaders() })
    expect(r.status()).toBe(404)

    const check = await request.get(`/api/v1/market-events/${eventId}`, { headers: apiHeaders() })
    expect(check.status()).toBe(200)
  })

  test("B's key cannot add an item to A's event — POST items → 404", async ({ request }) => {
    const r = await request.post(`/api/v1/market-events/${eventId}/items`, {
      headers: bHeaders(),
      data: { object_id: objId },
    })
    expect(r.status()).toBe(404)

    // Confirm nothing was actually added, as A.
    const check = await request.get(`/api/v1/market-events/${eventId}`, { headers: apiHeaders() })
    const event = await check.json()
    expect(event.items).toHaveLength(0)
  })

  test("B's key cannot bulk-add items to A's event → 404", async ({ request }) => {
    const r = await request.post(`/api/v1/market-events/${eventId}/items/bulk`, {
      headers: bHeaders(),
      data: { object_ids: [objId] },
    })
    expect(r.status()).toBe(404)
  })

  test("B's event list never includes A's event", async ({ request }) => {
    const r = await request.get('/api/v1/market-events', { headers: bHeaders() })
    expect(r.status()).toBe(200)
    const body = await r.json()
    const ids = (body.data as { id: string }[]).map(e => e.id)
    expect(ids).not.toContain(eventId)
  })
})
