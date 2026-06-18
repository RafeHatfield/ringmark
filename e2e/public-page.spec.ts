/**
 * Public page routing tests.
 *
 * These are the most security-critical E2E tests:
 *   - Logged-in OWNER visiting /p/[slug] must land on the admin page (not the public page)
 *   - Anonymous users see public content only when the object is published
 *   - private_notes must never leak to anonymous users
 *   - Unknown slugs return a graceful not-found message
 */
import { test, expect } from '@playwright/test'
import path from 'path'
import { updateObjectAdmin } from './helpers/supabase-admin'

// No file-level test.use({ storageState }) — it bleeds into browser.newContext() calls
// Each test that needs auth receives it explicitly via storageState on { page } fixture or context
const AUTH_STATE = path.join(__dirname, '.auth/user.json')
const PRIVATE_NOTE = 'PUBPAGE_PRIVATE_CANARY_MUST_NOT_LEAK'
const LOCATION_CANARY = 'LOCATION-TEXT-CANARY-E2E-2026'

let publishedObjectId = ''
let publishedSlug = ''
let publishedWorkshopId = ''
let unpublishedObjectId = ''
let unpublishedSlug = ''

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: AUTH_STATE })
  const page = await ctx.newPage()

  // ── Create and publish an object ──────────────────────────────────────────
  await page.goto('/objects/new?type=source')
  await page.getByPlaceholder('Where did this wood come from? Who gave it to you?').fill(PRIVATE_NOTE)
  await Promise.all([
    page.waitForURL(/\/objects\/[0-9a-f]{8}-/),
    page.getByRole('button', { name: 'Save' }).click(),
  ])
  publishedObjectId = page.url().split('/objects/')[1]
  publishedWorkshopId = (await page.locator('h1.font-mono').textContent())?.trim() ?? ''

  // Set location_text canary directly — bypasses UI, tests the query layer
  await updateObjectAdmin(publishedObjectId, { location_text: LOCATION_CANARY })

  // Write a story and publish
  await page.goto(`/objects/${publishedObjectId}/story`)
  await page.getByPlaceholder('e.g. Lynn Valley Maple').fill('Public Page Test Object')
  await page.getByRole('button', { name: 'Save draft' }).click()
  await expect(page.getByText('Saved.')).toBeVisible()
  await page.getByRole('button', { name: 'Publish' }).click()
  await expect(page.getByText('Published')).toBeVisible()
  const publishedLink = page.locator('a[href^="/p/"]')
  const publishedHref = await publishedLink.getAttribute('href')
  publishedSlug = publishedHref?.replace('/p/', '') ?? ''

  // ── Create an unpublished object ──────────────────────────────────────────
  await page.goto('/objects/new?type=source')
  await Promise.all([
    page.waitForURL(/\/objects\/[0-9a-f]{8}-/),
    page.getByRole('button', { name: 'Save' }).click(),
  ])
  unpublishedObjectId = page.url().split('/objects/')[1]

  // We need the public_slug even without publishing — grab it from the QR section
  const qrText = await page.locator('p.font-mono.text-bark').textContent()
  // format: "/p/{slug}"
  unpublishedSlug = qrText?.replace('/p/', '').trim() ?? ''

  await ctx.close()
})

// ── Owner view ────────────────────────────────────────────────────────────────

test('logged-in owner visiting /p/[slug] sees the public view with an edit link', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: AUTH_STATE })
  const page = await ctx.newPage()
  await page.goto(`/p/${publishedSlug}`)
  // Stays on the public page — no redirect
  await expect(page).toHaveURL(`/p/${publishedSlug}`)
  // Owner bar with edit link is visible
  await expect(page.getByRole('link', { name: /Edit story/ })).toBeVisible()
  await ctx.close()
})

// ── Anonymous access ──────────────────────────────────────────────────────────

test('anonymous user sees the public story page for a published object', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: undefined })
  const page = await ctx.newPage()

  await page.goto(`/p/${publishedSlug}`)
  await expect(page.getByText('Public Page Test Object')).toBeVisible()
  // Must NOT be redirected to admin
  await expect(page).not.toHaveURL(/\/objects\//)

  await ctx.close()
})

test('anonymous user sees a placeholder for an unpublished object (not blank, not 404)', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: undefined })
  const page = await ctx.newPage()

  await page.goto(`/p/${unpublishedSlug}`)
  // Must show the "not published" message
  await expect(page.getByText("published yet", { exact: false })).toBeVisible()
  // Must NOT show real content or crash
  await expect(page).not.toHaveURL(/\/objects\//)

  await ctx.close()
})

test('private_notes never appear on the anonymous public page', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: undefined })
  const page = await ctx.newPage()

  await page.goto(`/p/${publishedSlug}`)
  const bodyText = await page.locator('body').textContent()
  expect(bodyText).not.toContain(PRIVATE_NOTE)

  await ctx.close()
})

test('location_text never appears on the anonymous public page', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: undefined })
  const page = await ctx.newPage()

  await page.goto(`/p/${publishedSlug}`)
  const html = await page.content()
  expect(html).not.toContain(LOCATION_CANARY)

  await ctx.close()
})

test('workshop_id never appears on the anonymous public page', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: undefined })
  const page = await ctx.newPage()

  await page.goto(`/p/${publishedSlug}`)
  const html = await page.content()
  expect(html).not.toContain(publishedWorkshopId)

  await ctx.close()
})

test('unknown slug shows "could not be found" (not a crash, not a blank page)', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: undefined })
  const page = await ctx.newPage()

  await page.goto('/p/slug-that-definitely-does-not-exist-xyz')
  await expect(page.getByText('could not be found', { exact: false })).toBeVisible()

  await ctx.close()
})

// ── Admin routes inaccessible to anonymous users ──────────────────────────────

test('anonymous user visiting admin detail page is redirected to /login', async ({ browser }) => {
  // Explicitly NO storageState — truly anonymous context
  const ctx = await browser.newContext({ storageState: undefined })
  const page = await ctx.newPage()

  await page.goto(`/objects/${publishedObjectId}`)
  await expect(page).toHaveURL(/\/login/)

  await ctx.close()
})
