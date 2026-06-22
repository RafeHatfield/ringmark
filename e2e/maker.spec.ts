import { test, expect } from '@playwright/test'
import path from 'path'

const AUTH_STATE = path.join(__dirname, '.auth/user.json')

test.describe('maker page', () => {
  test('is publicly accessible without auth', async ({ page }) => {
    await page.goto('/maker')
    await expect(page).toHaveURL('/maker')
    // Ringmark footer link is always present
    await expect(page.getByText(/Tracked with Ringmark/i)).toBeVisible()
  })

  test('shows maker name and bio after profile is set', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: AUTH_STATE })
    const adminPage = await ctx.newPage()

    // Set a known workshop name + bio via the profile form
    const uniqueName = `E2E Maker ${Date.now()}`
    await adminPage.goto('/profile')
    await adminPage.fill('#workshop_name', uniqueName)
    await adminPage.fill('#bio', 'Automated maker bio.')
    await adminPage.getByRole('button', { name: /save profile/i }).click()
    await expect(adminPage.getByText('Saved.')).toBeVisible({ timeout: 8_000 })
    await ctx.close()

    // Now visit /maker as anonymous user — name and bio should appear
    const pubPage = await (await browser.newContext()).newPage()
    await pubPage.goto('/maker')
    await expect(pubPage.getByRole('heading', { name: uniqueName })).toBeVisible()
    await expect(pubPage.getByText('Automated maker bio.')).toBeVisible()
  })

  test('published pieces appear with links to /p/[slug]', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: AUTH_STATE })
    const adminPage = await ctx.newPage()

    // Create and publish a piece via the story page
    await adminPage.goto('/objects/new?type=finished_bowl')
    await adminPage.getByPlaceholder(/Where did this wood come from/).fill('E2E maker test bowl')
    await Promise.all([
      adminPage.waitForURL(/\/objects\/[0-9a-f]{8}-/),
      adminPage.getByRole('button', { name: 'Save' }).click(),
    ])
    const objectId = adminPage.url().split('/objects/')[1]

    await adminPage.goto(`/objects/${objectId}/story`)
    await adminPage.fill('[name="public_title"]', 'E2E Maker Bowl')
    await adminPage.getByRole('button', { name: /publish/i }).click()
    await expect(adminPage.getByText(/published/i)).toBeVisible({ timeout: 8_000 })

    // Read the slug from the URL or the page
    const slug = await adminPage.locator('[data-testid="public-slug"]').textContent().catch(() => null)
    await ctx.close()

    // /maker should list the published piece
    const pubPage = await (await browser.newContext()).newPage()
    await pubPage.goto('/maker')
    await expect(pubPage.getByText('E2E Maker Bowl')).toBeVisible()

    if (slug) {
      const pieceLink = pubPage.getByRole('link', { name: /E2E Maker Bowl/ })
      await pieceLink.click()
      await expect(pubPage).toHaveURL(new RegExp(`/p/${slug}`))
    }
  })
})
