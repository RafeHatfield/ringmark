import { test, expect } from '@playwright/test'
import path from 'path'
import { TEST_EMAIL, TEST_PASSWORD } from './helpers/supabase-admin'

const AUTH_STATE = path.join(__dirname, '.auth/user.json')
const OTHER_AUTH_STATE = path.join(__dirname, '.auth/other-user.json')

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

  test('sign out button is visible in the admin header', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
  })

  test('signing out redirects to /auth and clears the session', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/auth/)
    // Confirm session is actually cleared — navigating to admin should redirect back to /auth
    await page.goto('/')
    await expect(page).toHaveURL(/\/auth/)
  })
})

test.describe('auth — non-owner access', () => {
  let firstUserObjectId = ''

  test.beforeAll(async ({ browser }) => {
    // Create an object owned by the primary test user
    const ctx = await browser.newContext({ storageState: AUTH_STATE })
    const page = await ctx.newPage()
    await page.goto('/objects/new?type=source')
    await Promise.all([
      page.waitForURL(/\/objects\/[0-9a-f]{8}-/),
      page.getByRole('button', { name: 'Save' }).click(),
    ])
    firstUserObjectId = page.url().split('/objects/')[1]
    await ctx.close()
  })

  test('authenticated non-owner cannot access another user\'s object', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: OTHER_AUTH_STATE })
    const page = await ctx.newPage()

    await page.goto(`/objects/${firstUserObjectId}`)

    // Must land on the not-found page — not the object, and not redirected to /auth.
    // We assert on content rather than HTTP status because Next.js dev mode returns
    // 200 for notFound() boundaries; the content check is what actually matters.
    await expect(page.getByText('Object not found')).toBeVisible()
    await expect(page).not.toHaveURL(/\/auth/)

    await ctx.close()
  })
})
