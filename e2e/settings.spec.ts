import { test, expect } from '@playwright/test'

test.use({ storageState: 'e2e/.auth/user.json' })

test.describe('settings page', () => {
  test('requires auth — redirects to /login when unauthenticated', async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.goto('/settings')
    await expect(page).toHaveURL(/\/login/)
    await ctx.close()
  })

  test('renders members section and invite button', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    await expect(page.getByRole('button', { name: /generate invite link/i })).toBeVisible()
  })

  test('generate invite link creates a URL with /invite/ path', async ({ page }) => {
    await page.goto('/settings')
    await page.getByRole('button', { name: /generate invite link/i }).click()

    // After redirect, the invite token appears in the URL
    await expect(page).toHaveURL(/[?&]invite=/, { timeout: 8_000 })

    // The invite URL is shown on the page
    await expect(page.getByText(/\/invite\//)).toBeVisible()
  })
})
