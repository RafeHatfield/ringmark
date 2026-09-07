/**
 * Market Mode admin UI.
 *
 * e2e/market-events.spec.ts covers the REST contract. This file covers the
 * pages a person actually touches — the loop Rafe runs at a market: build the
 * list, price it, print it, then tap things sold at the table.
 *
 * The assertion that matters most is the sold toggle. It is the one control
 * used with a customer standing there, it writes to two tables (the item and
 * the underlying object's status), and it is optimistic — so a regression
 * shows up as a UI that looks right and a database that isn't. Every sold
 * assertion therefore checks the rendered state AND the persisted state.
 *
 * Each test seeds its own event and pieces. An earlier draft shared one
 * fixture across the file and chained state between tests; a single failure
 * restarted the worker, re-ran beforeAll, and every later assertion was then
 * reading a different fixture than it wrote. Self-contained is slower and
 * worth it.
 *
 * Fixtures are created through the service role rather than the UI: this spec
 * is about the market pages, and driving object creation through forms would
 * make it fail for reasons that have nothing to do with them.
 */

import { test, expect, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import path from 'path'
import { TEST_EMAIL } from './helpers/supabase-admin'

const AUTH_STATE = path.join(__dirname, '.auth/user.json')

test.use({ storageState: AUTH_STATE })

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

let accountId = ''

test.beforeAll(async () => {
  const db = admin()
  const { data: { users } } = await db.auth.admin.listUsers()
  const user = users.find(u => u.email === TEST_EMAIL)
  if (!user) throw new Error(`Test user ${TEST_EMAIL} not found`)

  const { data: membership } = await db
    .from('account_members')
    .select('account_id')
    .eq('user_id', user.id)
    .limit(1)
    .single()
  if (!membership) throw new Error('Test user has no account')
  accountId = membership.account_id
})

type Piece = { wid: string; id: string; title: string; price: number | null }
type Fixture = { eventId: string; pieces: Piece[]; cleanup: () => Promise<void> }

/**
 * Creates an isolated market event with `pieces` objects, the first `onEvent`
 * of which are already on it. Returns a cleanup that removes everything.
 */
async function seed(opts: { pieces: Array<{ title: string; price: number | null }>; onEvent: number }): Promise<Fixture> {
  const db = admin()
  const tag = `MK${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 900 + 100)}`
  const pieces: Piece[] = []

  for (const [i, p] of opts.pieces.entries()) {
    const wid = `${tag}${String.fromCharCode(65 + i)}`
    const { data, error } = await db
      .from('wood_objects')
      .insert({
        account_id: accountId,
        workshop_id: wid,
        workshop_id_lower: wid.toLowerCase(),
        public_slug: `${wid.toLowerCase()}-${Date.now()}`,
        object_type: 'finished_bowl',
        title: p.title,
        species: 'Bigleaf Maple',
        status: 'for_sale',
        price_cents: p.price,
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`Fixture ${wid} failed: ${error?.message}`)
    pieces.push({ wid, id: data.id, title: p.title, price: p.price })
  }

  const { data: event, error: evErr } = await db
    .from('market_events')
    .insert({
      account_id: accountId,
      name: `${tag} Farmers Market`,
      event_date: '2026-09-12',
      location_text: 'Lynn Valley',
    })
    .select('id')
    .single()
  if (evErr || !event) throw new Error(`Event fixture failed: ${evErr?.message}`)

  const seeded = pieces.slice(0, opts.onEvent)
  if (seeded.length) {
    await db.from('market_event_items').insert(
      seeded.map((p, i) => ({
        account_id: accountId,
        market_event_id: event.id,
        object_id: p.id,
        asking_price_cents: p.price,
        sort_order: i,
      })),
    )
  }

  return {
    eventId: event.id,
    pieces,
    cleanup: async () => {
      try {
        await db.from('market_events').delete().eq('id', event.id)
        await db.from('wood_objects').delete().in('id', pieces.map(p => p.id))
      } catch { /* best-effort — never mask a real failure */ }
    },
  }
}

/** Persisted state, so optimistic UI can't fake a passing assertion. */
async function persisted(eventId: string, objectId: string) {
  const db = admin()
  const [{ data: obj }, { data: item }] = await Promise.all([
    db.from('wood_objects').select('status, price_cents').eq('id', objectId).single(),
    db.from('market_event_items')
      .select('sold, sold_price_cents, asking_price_cents')
      .eq('market_event_id', eventId)
      .eq('object_id', objectId)
      .maybeSingle(),
  ])
  return { status: obj?.status ?? null, item }
}

function soldToggleFor(page: Page, wid: string) {
  return page
    .locator('li')
    .filter({ hasText: wid })
    .locator('button[aria-pressed]')
    .first()
}

// ── Navigation and list ───────────────────────────────────────────────────────

test('Markets is reachable from the admin nav', async ({ page }) => {
  await page.goto('/workshop')
  await page.getByRole('link', { name: 'Markets' }).click()
  await expect(page).toHaveURL(/\/markets$/)
})

test('the markets list shows an event with its location', async ({ page }) => {
  const fx = await seed({ pieces: [{ title: 'Maple Salad Bowl', price: 12000 }], onEvent: 1 })
  try {
    await page.goto('/markets')
    await expect(page.getByText(`${fx.pieces[0].wid.slice(0, -1)} Farmers Market`)).toBeVisible()
    await expect(page.getByText('Lynn Valley').first()).toBeVisible()
  } finally {
    await fx.cleanup()
  }
})

test('creating a market from the form lands on its builder page', async ({ page }) => {
  const name = `UICREATE${Date.now().toString(36).toUpperCase()}`
  await page.goto('/markets/new')

  await page.getByLabel('Name').fill(name)
  await page.getByRole('button', { name: 'Save' }).click()

  await page.waitForURL(/\/markets\/[0-9a-f]{8}-/, { timeout: 20000 })
  await expect(page.getByText(name)).toBeVisible()

  const createdId = page.url().split('/markets/')[1].split(/[?#]/)[0]
  await admin().from('market_events').delete().eq('id', createdId)
})

// ── The builder ───────────────────────────────────────────────────────────────

test('the builder lists seeded pieces and totals only what is priced', async ({ page }) => {
  const fx = await seed({
    pieces: [
      { title: 'Maple Salad Bowl', price: 12000 },
      { title: 'Cedar Platter', price: null },
    ],
    onEvent: 2,
  })
  try {
    await page.goto(`/markets/${fx.eventId}`, { waitUntil: 'networkidle' })

    await expect(page.getByText(fx.pieces[0].wid).first()).toBeVisible()
    await expect(page.getByText('Cedar Platter').first()).toBeVisible()

    // $120 priced + one unpriced — the total must not invent a value for the
    // unpriced piece.
    const totals = page.locator('dl').filter({ hasText: 'Asking total' })
    await expect(totals).toContainText('$120')
  } finally {
    await fx.cleanup()
  }
})

test('the picker adds a piece, defaulting its asking price from the object', async ({ page }) => {
  const fx = await seed({
    pieces: [
      { title: 'Maple Salad Bowl', price: 12000 },
      { title: 'Walnut Scoop', price: 4500 },
    ],
    onEvent: 1,
  })
  const toAdd = fx.pieces[1]
  try {
    await page.goto(`/markets/${fx.eventId}`, { waitUntil: 'networkidle' })

    await page.getByRole('button', { name: /add pieces/i }).click()
    await page.getByLabel('Search pieces to add').fill(toAdd.wid)

    const row = page.locator('label').filter({ hasText: toAdd.wid })
    await expect(row).toBeVisible()
    await row.locator('input[type="checkbox"]').check()
    await page.getByRole('button', { name: /add \d+ to market/i }).click()

    await expect(page.getByText(toAdd.title).first()).toBeVisible({ timeout: 20000 })

    await expect
      .poll(async () => (await persisted(fx.eventId, toAdd.id)).item?.asking_price_cents, { timeout: 20000 })
      .toBe(4500)
  } finally {
    await fx.cleanup()
  }
})

test('editing an asking price persists it', async ({ page }) => {
  const fx = await seed({ pieces: [{ title: 'Maple Salad Bowl', price: 12000 }], onEvent: 1 })
  const piece = fx.pieces[0]
  try {
    await page.goto(`/markets/${fx.eventId}`, { waitUntil: 'networkidle' })

    // The price is a button showing the current value until you tap it; the
    // input only exists while that row is being edited.
    const row = page.locator('li').filter({ hasText: piece.wid })
    await row.getByRole('button', { name: '$120' }).click()

    const input = page.getByLabel(`Asking price for ${piece.wid}`)
    await input.fill('155.50')
    await row.getByRole('button', { name: 'Save' }).click()

    await expect
      .poll(async () => (await persisted(fx.eventId, piece.id)).item?.asking_price_cents, { timeout: 20000 })
      .toBe(15550)
  } finally {
    await fx.cleanup()
  }
})

// ── The sold toggle — the control that matters ───────────────────────────────

test('marking sold updates the item AND cascades to the object status', async ({ page }) => {
  const fx = await seed({ pieces: [{ title: 'Maple Salad Bowl', price: 12000 }], onEvent: 1 })
  const piece = fx.pieces[0]
  try {
    await page.goto(`/markets/${fx.eventId}`, { waitUntil: 'networkidle' })

    const before = await persisted(fx.eventId, piece.id)
    expect(before.status).toBe('for_sale')
    expect(before.item?.sold).toBe(false)

    const toggle = soldToggleFor(page, piece.wid)
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await toggle.click()

    await expect(toggle).toHaveAttribute('aria-pressed', 'true', { timeout: 20000 })

    // Persisted state — the whole point. Optimistic UI must not fake this.
    await expect
      .poll(async () => (await persisted(fx.eventId, piece.id)).item?.sold, { timeout: 20000 })
      .toBe(true)

    const after = await persisted(fx.eventId, piece.id)
    expect(after.status, 'marking sold must cascade to the object').toBe('sold')
    expect(after.item?.sold_price_cents, 'sold price defaults to the asking price').toBe(12000)
  } finally {
    await fx.cleanup()
  }
})

test('undoing a sale reverts the item and the object status to for_sale', async ({ page }) => {
  const fx = await seed({ pieces: [{ title: 'Maple Salad Bowl', price: 12000 }], onEvent: 1 })
  const piece = fx.pieces[0]
  try {
    await page.goto(`/markets/${fx.eventId}`, { waitUntil: 'networkidle' })
    const toggle = soldToggleFor(page, piece.wid)

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true', { timeout: 20000 })
    await expect
      .poll(async () => (await persisted(fx.eventId, piece.id)).item?.sold, { timeout: 20000 })
      .toBe(true)

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false', { timeout: 20000 })
    await expect
      .poll(async () => (await persisted(fx.eventId, piece.id)).item?.sold, { timeout: 20000 })
      .toBe(false)

    const after = await persisted(fx.eventId, piece.id)
    // Reverts to for_sale unconditionally — deliberate, not to a remembered status.
    expect(after.status).toBe('for_sale')
    expect(after.item?.sold_price_cents).toBeNull()
  } finally {
    await fx.cleanup()
  }
})

// ── Print views ───────────────────────────────────────────────────────────────

test('the packing list shows every piece and no prices', async ({ page }) => {
  const fx = await seed({
    pieces: [
      { title: 'Maple Salad Bowl', price: 12000 },
      { title: 'Cedar Platter', price: 4500 },
    ],
    onEvent: 2,
  })
  try {
    await page.goto(`/markets/${fx.eventId}/pack`, { waitUntil: 'networkidle' })
    await expect(page.getByText(fx.pieces[0].wid).first()).toBeVisible()
    await expect(page.getByText(fx.pieces[1].wid).first()).toBeVisible()
    // Packing is about presence, not money.
    await expect(page.locator('body')).not.toContainText('$120')
  } finally {
    await fx.cleanup()
  }
})

test('the price sheet shows each price and a total', async ({ page }) => {
  const fx = await seed({
    pieces: [
      { title: 'Maple Salad Bowl', price: 12000 },
      { title: 'Cedar Platter', price: 4500 },
    ],
    onEvent: 2,
  })
  try {
    await page.goto(`/markets/${fx.eventId}/price-sheet`, { waitUntil: 'networkidle' })
    const body = page.locator('body')
    await expect(body).toContainText('$120')
    await expect(body).toContainText('$45')
    await expect(body).toContainText('$165')   // total
  } finally {
    await fx.cleanup()
  }
})

test('the label sheet renders one QR per piece', async ({ page }) => {
  const fx = await seed({
    pieces: [
      { title: 'Maple Salad Bowl', price: 12000 },
      { title: 'Cedar Platter', price: 4500 },
    ],
    onEvent: 2,
  })
  try {
    await page.goto(`/markets/${fx.eventId}/labels`, { waitUntil: 'networkidle' })
    await expect(page.getByText(fx.pieces[0].wid).first()).toBeVisible()
    const codes = page.locator('canvas, svg[role="img"], img[alt*="QR" i]')
    await expect.poll(async () => await codes.count(), { timeout: 20000 }).toBeGreaterThanOrEqual(2)
  } finally {
    await fx.cleanup()
  }
})

// ── Auth and isolation ────────────────────────────────────────────────────────

test('another account\'s market event is not reachable', async ({ page }) => {
  const db = admin()
  const { data: otherAccount } = await db
    .from('accounts')
    .select('id')
    .neq('id', accountId)
    .limit(1)
    .maybeSingle()

  test.skip(!otherAccount, 'needs a second account to test isolation')

  const { data: foreign } = await db
    .from('market_events')
    .insert({ account_id: otherAccount!.id, name: `FOREIGN${Date.now()}` })
    .select('id, name')
    .single()

  try {
    await page.goto(`/markets/${foreign!.id}`)
    // Asserting on content rather than status: notFound() renders the
    // not-found page with a 200 in this setup — /objects/<unknown> behaves
    // identically and long predates Market Mode. What must hold is that no
    // part of another account's event is ever rendered.
    await expect(page.locator('body')).not.toContainText(foreign!.name)
    await expect(page.locator('body')).not.toContainText('Asking total')
  } finally {
    await db.from('market_events').delete().eq('id', foreign!.id)
  }
})
