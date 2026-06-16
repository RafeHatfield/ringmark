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

test.use({ storageState: 'e2e/.auth/user.json' })

const AUTH_STATE = path.join(__dirname, '.auth/user.json')
const PRIVATE_NOTE = 'PUBPAGE_PRIVATE_CANARY_MUST_NOT_LEAK'

let publishedObjectId = ''
let publishedSlug = ''
let unpublishedObjectId = ''
let unpublishedSlug = ''

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: AUTH_STATE })
  const page = await ctx.newPage()

  // ── Create and publish an object ──────────────────────────────────────────
  await page.goto('/objects/new?type=source')
  await page.getByPlaceholder('Where it came from, who gave it to you, etc.').fill(PRIVATE_NOTE)
  await page.getByRole('button', { name: 'Save' }).click()
  await page.waitForURL(/\/objects\/[^/]+$/)
  publishedObjectId = page.url().split('/objects/')[1]

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
  await page.getByRole('button', { name: 'Save' }).click()
  await page.waitForURL(/\/objects\/[^/]+$/)
  unpublishedObjectId = page.url().split('/objects/')[1]

  // We need the public_slug even without publishing — grab it from the QR section
  const qrText = await page.locator('p.font-mono.text-muted-foreground').textContent()
  // format: "/p/{slug}"
  unpublishedSlug = qrText?.replace('/p/', '').trim() ?? ''

  await ctx.close()
})

// ── Owner redirect ────────────────────────────────────────────────────────────

test('logged-in owner visiting /p/[slug] is redirected to the admin page', async ({ page }) => {
  await page.goto(`/p/${publishedSlug}`)
  await expect(page).toHaveURL(`/objects/${publishedObjectId}`)
})

// ── Anonymous access ──────────────────────────────────────────────────────────

test('anonymous user sees the public story page for a published object', async ({ browser }) => {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()

  await page.goto(`/p/${publishedSlug}`)
  await expect(page.getByText('Public Page Test Object')).toBeVisible()
  // Must NOT be redirected to admin
  await expect(page).not.toHaveURL(/\/objects\//)

  await ctx.close()
})

test('anonymous user sees a placeholder for an unpublished object (not blank, not 404)', async ({ browser }) => {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()

  await page.goto(`/p/${unpublishedSlug}`)
  // Must show the "not published" message
  await expect(page.getByText("published yet", { exact: false })).toBeVisible()
  // Must NOT show real content or crash
  await expect(page).not.toHaveURL(/\/objects\//)

  await ctx.close()
})

test('private_notes never appear on the anonymous public page', async ({ browser }) => {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()

  await page.goto(`/p/${publishedSlug}`)
  const bodyText = await page.locator('body').textContent()
  expect(bodyText).not.toContain(PRIVATE_NOTE)

  await ctx.close()
})

test('unknown slug shows "could not be found" (not a crash, not a blank page)', async ({ browser }) => {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()

  await page.goto('/p/slug-that-definitely-does-not-exist-xyz')
  await expect(page.getByText('could not be found', { exact: false })).toBeVisible()

  await ctx.close()
})

// ── Admin routes inaccessible to anonymous users ──────────────────────────────

test('anonymous user visiting admin detail page is redirected to /auth', async ({ browser }) => {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()

  await page.goto(`/objects/${publishedObjectId}`)
  await expect(page).toHaveURL(/\/auth/)

  await ctx.close()
})
