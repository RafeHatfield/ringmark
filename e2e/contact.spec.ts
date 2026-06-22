import { test, expect } from '@playwright/test'

test.describe('contact page', () => {
  test('is publicly accessible without auth', async ({ page }) => {
    await page.goto('/contact')
    await expect(page).toHaveURL('/contact')
    await expect(page.getByRole('heading', { name: /get in touch/i })).toBeVisible()
  })

  test('submitting empty form shows validation error', async ({ page }) => {
    await page.goto('/contact')
    // Disable native browser validation so the server action runs with empty fields
    await page.locator('form').evaluate((f: HTMLFormElement) => { f.noValidate = true })
    await page.getByRole('button', { name: /send message/i }).click()
    await expect(page.getByText(/all fields are required/i)).toBeVisible()
  })

  test('submitting invalid email shows validation error', async ({ page }) => {
    await page.goto('/contact')
    // Disable native browser validation so the server-side email regex runs
    await page.locator('form').evaluate((f: HTMLFormElement) => { f.noValidate = true })
    await page.fill('[name="name"]', 'Test User')
    await page.fill('[name="email"]', 'not-valid')
    await page.fill('[name="message"]', 'Hello')
    await page.getByRole('button', { name: /send message/i }).click()
    await expect(page.getByText(/valid email address/i)).toBeVisible()
  })

  test('valid submission shows a response (success or configured error)', async ({ page }) => {
    await page.goto('/contact')
    await page.fill('[name="name"]', 'E2E Test')
    await page.fill('[name="email"]', 'e2e@example.com')
    await page.fill('[name="message"]', 'Automated test message — please ignore.')
    await page.getByRole('button', { name: /send message/i }).click()

    // Accept success OR "not configured" (when RESEND_API_KEY is not set locally).
    // What we're verifying: the action ran and responded, no unhandled 500 error.
    await expect(
      page.getByText('Message sent.').or(page.getByText(/not configured|something went wrong/i))
    ).toBeVisible({ timeout: 10_000 })
  })
})
