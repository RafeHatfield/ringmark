import { test, expect } from '@playwright/test'
import path from 'path'

const AUTH_STATE = path.join(__dirname, '.auth/user.json')

test.describe('maker page', () => {
  test('is publicly accessible without auth', async ({ page }) => {
    await page.goto('/maker')
    await expect(page).toHaveURL('/maker')
    await expect(page.getByText(/Tracked with Ringmark/i)).toBeVisible()
  })

  test('shows a maker name heading', async ({ page }) => {
    // /maker always shows the first account's name.
    // In this shared Supabase environment the "first" account is the real maker account,
    // not the test user — so we verify the page renders a heading rather than a specific name.
    await page.goto('/maker')
    await expect(page.getByRole('heading').first()).toBeVisible()
  })

  test('published pieces appear in the Work section', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: AUTH_STATE })
    const adminPage = await ctx.newPage()

    // Create a source object
    await adminPage.goto('/objects/new?type=source')
    await Promise.all([
      adminPage.waitForURL(/\/objects\/[0-9a-f]{8}-/),
      adminPage.getByRole('button', { name: 'Save' }).click(),
    ])
    const objectId = adminPage.url().split('/objects/')[1]

    // Navigate to the story page and set a unique public title
    const uniqueTitle = `E2E Maker Piece ${Date.now()}`
    await adminPage.goto(`/objects/${objectId}/story`)
    // Story editor uses placeholder attributes, not name attributes
    await adminPage.getByPlaceholder('e.g. Lynn Valley Maple').fill(uniqueTitle)
    // Save draft first — Publish only flips is_published, doesn't save title fields
    await adminPage.getByRole('button', { name: 'Save draft' }).click()
    await expect(adminPage.getByText('Saved.')).toBeVisible({ timeout: 5_000 })
    await adminPage.getByRole('button', { name: 'Publish' }).click()
    await expect(adminPage.getByText('Published')).toBeVisible({ timeout: 8_000 })

    // Grab the public slug from the link that appears after publishing
    const slugLink = adminPage.locator('a[href^="/p/"]').first()
    const href = await slugLink.getAttribute('href')
    const slug = href?.replace('/p/', '') ?? ''
    expect(slug).toBeTruthy()

    await ctx.close()

    const pubCtx = await browser.newContext({ storageState: undefined })
    const pubPage = await pubCtx.newPage()

    // Verify the piece is publicly accessible at its own URL (primary publish test)
    await pubPage.goto(`/p/${slug}`)
    await expect(pubPage.getByText(uniqueTitle)).toBeVisible({ timeout: 5_000 })

    // Verify the maker page links to the newly published piece in the Work section
    await pubPage.goto('/maker')
    await expect(pubPage.locator(`a[href="/p/${slug}"]`)).toBeVisible({ timeout: 5_000 })

    // Clicking it navigates to the public story page
    await pubPage.locator(`a[href="/p/${slug}"]`).click()
    await expect(pubPage).toHaveURL(/\/p\//)

    await pubCtx.close()
  })
})
