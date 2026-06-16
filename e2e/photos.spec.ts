/**
 * Photo privacy E2E tests.
 *
 * Verifies that the is_public toggle on photos is immediately reflected
 * on the public story page — both directions.
 */
import { test, expect } from '@playwright/test'
import path from 'path'

const AUTH_STATE = path.join(__dirname, '.auth/user.json')

// Minimal valid 1×1 black pixel PNG (68 bytes) — accepted by Supabase Storage, no external file needed
const MINIMAL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

let objectId = ''
let publicSlug = ''

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: AUTH_STATE })
  const page = await ctx.newPage()

  // Create a source object
  await page.goto('/objects/new?type=source')
  await Promise.all([
    page.waitForURL(/\/objects\/[0-9a-f]{8}-/),
    page.getByRole('button', { name: 'Save' }).click(),
  ])
  objectId = page.url().split('/objects/')[1]

  // Publish it so the public page is accessible
  await page.goto(`/objects/${objectId}/story`)
  await page.getByPlaceholder('e.g. Lynn Valley Maple').fill('Photo Privacy Test Object')
  await page.getByRole('button', { name: 'Save draft' }).click()
  await expect(page.getByText('Saved.')).toBeVisible()
  await page.getByRole('button', { name: 'Publish' }).click()
  await expect(page.getByText('Published')).toBeVisible()
  const href = await page.locator('a[href^="/p/"]').getAttribute('href')
  publicSlug = href?.replace('/p/', '') ?? ''

  // Upload one photo — defaults to is_public: true
  await page.goto(`/objects/${objectId}`)
  await page.locator('input[type="file"]').setInputFiles({
    name: 'test-photo.png',
    mimeType: 'image/png',
    buffer: MINIMAL_PNG,
  })
  // Wait for upload to finish and photo card to appear
  await expect(page.locator('button[title="Make private"]')).toBeVisible({ timeout: 15000 })

  await ctx.close()
})

test('public photo appears on the anonymous public page', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: undefined })
  const page = await ctx.newPage()
  await page.goto(`/p/${publicSlug}`)
  await expect(page.locator('img')).toHaveCount(1, { timeout: 10000 })
  await ctx.close()
})

test('toggling a photo private removes it from the public page', async ({ browser }) => {
  const ownerCtx = await browser.newContext({ storageState: AUTH_STATE })
  const ownerPage = await ownerCtx.newPage()
  await ownerPage.goto(`/objects/${objectId}`)
  await ownerPage.locator('button[title="Make private"]').click()
  await expect(ownerPage.locator('button[title="Make public"]')).toBeVisible()
  await ownerCtx.close()

  const anonCtx = await browser.newContext({ storageState: undefined })
  const anonPage = await anonCtx.newPage()
  await anonPage.goto(`/p/${publicSlug}`)
  await expect(anonPage.locator('img')).toHaveCount(0)
  await anonCtx.close()
})

test('toggling a photo back to public restores it on the public page', async ({ browser }) => {
  const ownerCtx = await browser.newContext({ storageState: AUTH_STATE })
  const ownerPage = await ownerCtx.newPage()
  await ownerPage.goto(`/objects/${objectId}`)
  await ownerPage.locator('button[title="Make public"]').click()
  await expect(ownerPage.locator('button[title="Make private"]')).toBeVisible()
  await ownerCtx.close()

  const anonCtx = await browser.newContext({ storageState: undefined })
  const anonPage = await anonCtx.newPage()
  await anonPage.goto(`/p/${publicSlug}`)
  await expect(anonPage.locator('img')).toHaveCount(1, { timeout: 10000 })
  await anonCtx.close()
})
