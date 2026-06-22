import { test, expect } from '@playwright/test'

test.describe('profile page — unauthenticated', () => {
  test('requires auth — redirects to /login', async ({ browser }) => {
    // storageState: undefined overrides any file-level storageState on this context
    const ctx = await browser.newContext({ storageState: undefined })
    const page = await ctx.newPage()
    await page.goto('/profile')
    await expect(page).toHaveURL(/\/login/)
    await ctx.close()
  })
})

test.describe('profile page — authenticated', () => {
  test.use({ storageState: 'e2e/.auth/user.json' })

  test('renders the profile form', async ({ page }) => {
    await page.goto('/profile')
    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible()
    await expect(page.locator('#display_name')).toBeVisible()
    await expect(page.locator('#workshop_name')).toBeVisible()
    await expect(page.locator('#bio')).toBeVisible()
    await expect(page.locator('#website_url')).toBeVisible()
  })

  test('saves profile fields and shows confirmation', async ({ page }) => {
    await page.goto('/profile')

    const unique = `E2E Workshop ${Date.now()}`
    await page.fill('#workshop_name', unique)
    await page.fill('#bio', 'E2E test bio — automated.')
    await page.getByRole('button', { name: /save profile/i }).click()

    await expect(page.getByText('Saved.')).toBeVisible({ timeout: 8_000 })

    // Reload and verify persistence
    await page.reload()
    await expect(page.locator('#workshop_name')).toHaveValue(unique)
    await expect(page.locator('#bio')).toHaveValue('E2E test bio — automated.')
  })

  test('website field is optional and saves blank', async ({ page }) => {
    await page.goto('/profile')
    await page.fill('#website_url', '')
    await page.getByRole('button', { name: /save profile/i }).click()
    await expect(page.getByText('Saved.')).toBeVisible({ timeout: 8_000 })
  })
})
