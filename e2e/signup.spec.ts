/**
 * /signup page tests — step 3 of multi-user plan.
 *
 * Tests the page structure, form behaviour, and "check your inbox" generic
 * response state. We can't follow a real confirmation email in CI, so we
 * verify the UI lands in the correct post-submit state and that the form
 * never reveals whether an email is already registered.
 */

import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const SIGNUP_EMAIL = 'e2e-signup-test@ringmark.local'
const SIGNUP_PASSWORD = 'SignupE2ETest2026!'

async function deleteSignupTestUser() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
  const { data: { users } } = await admin.auth.admin.listUsers()
  const user = users.find(u => u.email === SIGNUP_EMAIL)
  if (user) await admin.auth.admin.deleteUser(user.id)
}

test.beforeAll(async () => {
  // Clean slate — remove any leftover signup test user from a previous run
  await deleteSignupTestUser()
})

test.afterAll(async () => {
  await deleteSignupTestUser()
})

// ── Page structure ────────────────────────────────────────────────────────────

test('signup page renders with Google button, email/password form, and sign-in link', async ({ page }) => {
  await page.goto('/signup')

  await expect(page.getByRole('button', { name: /sign up with google/i })).toBeVisible()
  await expect(page.getByLabel('Email')).toBeVisible()
  await expect(page.getByLabel('Password')).toBeVisible()
  await expect(page.getByRole('button', { name: /create account/i })).toBeVisible()
  await expect(page.getByRole('link', { name: /sign in/i })).toBeVisible()
})

test('sign-in link on signup page navigates to /login', async ({ page }) => {
  await page.goto('/signup')
  await page.getByRole('link', { name: /sign in/i }).click()
  await expect(page).toHaveURL('/login')
})

test('login page has a "create one" link to /signup', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('link', { name: /create one/i })).toBeVisible()
  await page.getByRole('link', { name: /create one/i }).click()
  await expect(page).toHaveURL('/signup')
})

// ── Form submission ───────────────────────────────────────────────────────────

test('submitting a new email shows the generic "check your inbox" state', async ({ page }) => {
  await page.goto('/signup')
  await page.getByLabel('Email').fill(SIGNUP_EMAIL)
  await page.getByLabel('Password').fill(SIGNUP_PASSWORD)
  await page.getByRole('button', { name: /create account/i }).click()

  // Should show generic confirmation — not a success/failure distinction
  await expect(page.getByText(/check your inbox/i)).toBeVisible({ timeout: 10000 })
  await expect(page.getByText(/confirmation link/i)).toBeVisible()
  // "Back to sign in" link replaces the form
  await expect(page.getByRole('link', { name: /back to sign in/i })).toBeVisible()
  // Form itself should be gone
  await expect(page.getByLabel('Email')).not.toBeVisible()
})

test('submitting an already-registered email shows the same generic state (no enumeration)', async ({ page }) => {
  // The test user from global-setup is already registered
  await page.goto('/signup')
  await page.getByLabel('Email').fill('e2e@ringmark.local')
  await page.getByLabel('Password').fill('SomePassword123!')
  await page.getByRole('button', { name: /create account/i }).click()

  // Must show the same "check your inbox" message — not "email already exists"
  await expect(page.getByText(/check your inbox/i)).toBeVisible({ timeout: 10000 })
  await expect(page.getByText(/confirmation link/i)).toBeVisible()
  // Must NOT reveal the email is taken
  await expect(page.getByText(/already/i)).not.toBeVisible()
  await expect(page.getByText(/taken/i)).not.toBeVisible()
  await expect(page.getByText(/registered/i)).not.toBeVisible()
})

test('password field has minlength=8 enforced by the browser', async ({ page }) => {
  await page.goto('/signup')
  await page.getByLabel('Email').fill(SIGNUP_EMAIL)
  await page.getByLabel('Password').fill('short')

  // HTML5 minlength validation prevents submit — form stays visible
  await page.getByRole('button', { name: /create account/i }).click()
  await expect(page.getByLabel('Password')).toBeVisible()
  await expect(page.getByText(/check your inbox/i)).not.toBeVisible()
})
