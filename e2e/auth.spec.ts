import { test, expect } from '@playwright/test'
import { TEST_EMAIL, TEST_PASSWORD } from './helpers/supabase-admin'

// Auth tests deliberately do NOT use saved storage state — they test the login flow itself

test.describe('auth — unauthenticated access', () => {
  test('GET / redirects to /auth', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/auth/)
  })

  test('GET /objects/any-id redirects to /auth', async ({ page }) => {
    await page.goto('/objects/00000000-0000-0000-0000-000000000000')
    await expect(page).toHaveURL(/\/auth/)
  })
})

test.describe('auth — sign-in form', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/auth')
  })

  test('sign-in form renders email and password fields', async ({ page }) => {
    await expect(page.locator('#email')).toBeVisible()
    await expect(page.locator('#password')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  })

  test('wrong password shows an inline error (not a blank page)', async ({ page }) => {
    await page.fill('#email', TEST_EMAIL)
    await page.fill('#password', 'definitely-wrong-password')
    await page.click('button[type="submit"]')

    // Should stay on /auth and show an error — not redirect anywhere
    await expect(page).toHaveURL(/\/auth/)
    await expect(page.locator('.text-destructive')).toBeVisible()
  })

  test('correct credentials redirect to home', async ({ page }) => {
    await page.fill('#email', TEST_EMAIL)
    await page.fill('#password', TEST_PASSWORD)
    await page.click('button[type="submit"]')

    await page.waitForURL('/')
    await expect(page.getByText('Ringmark')).toBeVisible()
  })
})

test.describe('auth — already authenticated', () => {
  test.use({ storageState: 'e2e/.auth/user.json' })

  test('visiting /auth while logged in redirects to /', async ({ page }) => {
    await page.goto('/auth')
    await expect(page).toHaveURL('/')
  })
})
