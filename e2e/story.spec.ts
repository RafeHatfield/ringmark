/**
 * Story editing and publishing flow.
 *
 * beforeAll creates a source object, then each test exercises the story editor.
 */
import { test, expect } from '@playwright/test'
import path from 'path'

test.use({ storageState: 'e2e/.auth/user.json' })

const AUTH_STATE = path.join(__dirname, '.auth/user.json')

const STORY_TITLE = 'E2E Maple Bowl'
const STORY_TEXT = 'This wood came from a backyard maple removed in 2024. E2E test object.'
const PRIVATE_NOTE = 'PRIVATE_E2E_CANARY_TEXT_MUST_NOT_APPEAR_ON_PUBLIC_PAGE'

let objectId = ''
let publicSlug = ''

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: AUTH_STATE })
  const page = await ctx.newPage()

  // Create a source with private notes
  await page.goto('/objects/new?type=source')
  // Fill in private notes — used in the privacy assertion tests
  await page.getByPlaceholder('Where did this wood come from? Who gave it to you?').fill(PRIVATE_NOTE)
  await Promise.all([
    page.waitForURL(/\/objects\/[0-9a-f]{8}-/),
    page.getByRole('button', { name: 'Save' }).click(),
  ])

  objectId = page.url().split('/objects/')[1]

  await ctx.close()
})

// ── Story editor ─────────────────────────────────────────────────────────────

test('story page loads for the object', async ({ page }) => {
  await page.goto(`/objects/${objectId}/story`)
  await expect(page.getByText('Public Story')).toBeVisible()
  await expect(page.getByText('Not published')).toBeVisible()
})

test('can fill in and save a story draft', async ({ page }) => {
  await page.goto(`/objects/${objectId}/story`)

  await page.getByPlaceholder('e.g. Lynn Valley Maple').fill(STORY_TITLE)
  await page.getByPlaceholder('Where this wood came from').fill(STORY_TEXT)

  await page.getByRole('button', { name: 'Save draft' }).click()

  // "Saved." confirmation appears
  await expect(page.getByText('Saved.')).toBeVisible()
})

test('story text persists after save (round-trip)', async ({ page }) => {
  await page.goto(`/objects/${objectId}/story`)

  const titleInput = page.getByPlaceholder('e.g. Lynn Valley Maple')
  await expect(titleInput).toHaveValue(STORY_TITLE)

  const storyArea = page.getByPlaceholder('Where this wood came from')
  await expect(storyArea).toHaveValue(STORY_TEXT)
})

// ── Publish ──────────────────────────────────────────────────────────────────

test('object starts as unpublished on the detail page', async ({ page }) => {
  await page.goto(`/objects/${objectId}`)
  await expect(page.getByText('Not published')).toBeVisible()
})

test('publish makes the public story page accessible', async ({ page }) => {
  await page.goto(`/objects/${objectId}/story`)
  await page.getByRole('button', { name: 'Publish' }).click()

  // Page refreshes; Published status and public slug link appear
  await expect(page.getByText('Published')).toBeVisible()
  const link = page.locator('a[href^="/p/"]')
  await expect(link).toBeVisible()

  // Capture the slug for subsequent tests
  const href = await link.getAttribute('href')
  publicSlug = href?.replace('/p/', '') ?? ''
  expect(publicSlug.length).toBeGreaterThan(0)
})

test('detail page shows Published badge after publishing', async ({ page }) => {
  await page.goto(`/objects/${objectId}`)
  // Two "Published" elements on detail page (header badge + Public Story section) — take first
  await expect(page.getByText('Published').first()).toBeVisible()
})

// ── Public page content ──────────────────────────────────────────────────────

test('public page shows story title and text', async ({ browser }) => {
  // Use a truly anonymous context — storageState: undefined prevents auth bleed from test.use()
  const ctx = await browser.newContext({ storageState: undefined })
  const page = await ctx.newPage()

  await page.goto(`/p/${publicSlug}`)
  await expect(page.getByText(STORY_TITLE)).toBeVisible()
  await expect(page.getByText(STORY_TEXT)).toBeVisible()

  await ctx.close()
})

test('private_notes NEVER appear on the public page', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: undefined })
  const page = await ctx.newPage()

  await page.goto(`/p/${publicSlug}`)
  // The canary text written as a private note must not appear anywhere
  const bodyText = await page.locator('body').textContent()
  expect(bodyText).not.toContain(PRIVATE_NOTE)

  await ctx.close()
})
