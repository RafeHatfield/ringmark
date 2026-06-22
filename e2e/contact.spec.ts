import { test, expect } from '@playwright/test'

test.describe('contact page', () => {
  test('is publicly accessible without auth', async ({ page }) => {
    await page.goto('/contact')
    await expect(page).toHaveURL('/contact')
    await expect(page.getByRole('heading', { name: /get in touch/i })).toBeVisible()
  })

  test('submitting empty form shows validation error', async ({ page }) => {
    await page.goto('/contact')
    await page.getByRole('button', { name: /send message/i }).click()
    await expect(page.getByText(/all fields are required/i)).toBeVisible()
  })

  test('submitting invalid email shows validation error', async ({ page }) => {
    await page.goto('/contact')
    await page.fill('[name="name"]', 'Test User')
    await page.fill('[name="email"]', 'not-an-email')
    await page.fill('[name="message"]', 'Hello')
    await page.getByRole('button', { name: /send message/i }).click()
    await expect(page.getByText(/valid email address/i)).toBeVisible()
  })

  test('valid submission shows success message', async ({ page }) => {
    await page.goto('/contact')
    await page.fill('[name="name"]', 'E2E Test')
    await page.fill('[name="email"]', 'e2e@example.com')
    await page.fill('[name="message"]', 'Automated test message — please ignore.')
    await page.getByRole('button', { name: /send message/i }).click()
    await expect(page.getByText('Message sent.')).toBeVisible({ timeout: 10_000 })
  })
})
