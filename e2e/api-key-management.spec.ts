/**
 * API key management UI tests — step 5 of multi-user plan.
 *
 * Verifies the Settings page API Keys section:
 * - Section renders with description and Generate button
 * - Label form appears on click, Cancel returns to list
 * - Empty label is blocked (required)
 * - Creating a key shows the reveal-once state with Copy button
 * - Done clears the reveal and adds the key to the list
 * - Revoke shows a confirm prompt; No cancels; Yes removes the key
 *
 * Server action and RLS coverage is in e2e/api-keys-rls.spec.ts.
 * This file covers the UI flow only.
 */

import { test, expect } from '@playwright/test'
import path from 'path'
import { createClient } from '@supabase/supabase-js'
import { getAccountIdForUser, ensureTestUser } from './helpers/supabase-admin'

const AUTH_STATE = path.join(__dirname, '.auth/user.json')

// Clean up any keys created during this test run
const createdKeyPrefixes: string[] = []
test.afterAll(async () => {
  if (createdKeyPrefixes.length === 0) return
  const userAId = await ensureTestUser()
  const accountId = await getAccountIdForUser(userAId)
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
  for (const prefix of createdKeyPrefixes) {
    await admin.from('api_keys').delete().eq('account_id', accountId).eq('key_prefix', prefix)
  }
})

test.describe('settings page — API Keys section', () => {
  test('API Keys section renders with description and generate button', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: AUTH_STATE })
    const page = await ctx.newPage()
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { name: /api keys/i })).toBeVisible()
    await expect(page.getByText(/shown once at creation/)).toBeVisible()
    await expect(page.getByRole('button', { name: /generate new key/i })).toBeVisible()
    await ctx.close()
  })

  test('clicking Generate new key shows label form with Cancel', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: AUTH_STATE })
    const page = await ctx.newPage()
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: /generate new key/i }).click()

    await expect(page.getByLabel('Label')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible()
    // Generate new key button should be gone (replaced by form)
    await expect(page.getByRole('button', { name: /generate new key/i })).not.toBeVisible()
    await ctx.close()
  })

  test('Cancel on create form returns to list without creating a key', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: AUTH_STATE })
    const page = await ctx.newPage()
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: /generate new key/i }).click()
    await page.getByLabel('Label').fill('should not be created')
    await page.getByRole('button', { name: 'Cancel' }).click()

    await expect(page.getByRole('button', { name: /generate new key/i })).toBeVisible()
    await expect(page.getByText('should not be created')).not.toBeVisible()
    await ctx.close()
  })

  test('Generate key button is disabled until a label is entered', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: AUTH_STATE })
    const page = await ctx.newPage()
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: /generate new key/i }).click()

    // Button is disabled with empty label
    const submitBtn = page.getByRole('button', { name: 'Generate key' })
    await expect(submitBtn).toBeDisabled()

    // Typing a label enables it
    await page.getByLabel('Label').fill('some label')
    await expect(submitBtn).toBeEnabled()

    // Clearing it disables again
    await page.getByLabel('Label').fill('')
    await expect(submitBtn).toBeDisabled()

    await ctx.close()
  })

  test('creating a key shows reveal-once state with rmk_ key and Copy button', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: AUTH_STATE })
    const page = await ctx.newPage()
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: /generate new key/i }).click()
    await page.getByLabel('Label').fill('ui-test create key')
    await page.getByRole('button', { name: 'Generate key' }).click()

    await expect(page.getByText(/Copy your key/i)).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: 'Copy' })).toBeVisible()
    await expect(page.getByText(/Done.*saved/i)).toBeVisible()

    // Key must be rmk_ + 32 hex chars, never in a URL
    const keyEl = page.locator('code')
    const keyText = await keyEl.textContent()
    expect(keyText).toMatch(/^rmk_[0-9a-f]{32}$/)
    const html = await page.content()
    expect(html).not.toContain(`href="${keyText}`)

    // Track prefix for cleanup
    if (keyText) createdKeyPrefixes.push(keyText.slice(0, 8))

    // Form is gone
    await expect(page.getByLabel('Label')).not.toBeVisible()
    await ctx.close()
  })

  test('Done clears the reveal and shows the key in the list', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: AUTH_STATE })
    const page = await ctx.newPage()
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: /generate new key/i }).click()
    await page.getByLabel('Label').fill('ui-test done key')
    await page.getByRole('button', { name: 'Generate key' }).click()
    await expect(page.getByText(/Copy your key/i)).toBeVisible({ timeout: 10000 })

    const keyEl = page.locator('code')
    const keyText = await keyEl.textContent()
    if (keyText) createdKeyPrefixes.push(keyText.slice(0, 8))

    await page.getByText(/Done.*saved/i).click()

    // Reveal gone, list restored
    await expect(page.getByText(/Copy your key/i)).not.toBeVisible()
    await expect(page.getByRole('button', { name: /generate new key/i })).toBeVisible()
    // Label appears in the key list
    await expect(page.getByText('ui-test done key')).toBeVisible()
    await ctx.close()
  })

  test('Revoke shows confirm prompt; No cancels without deleting', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: AUTH_STATE })
    const page = await ctx.newPage()
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')

    // Create a key to revoke
    await page.getByRole('button', { name: /generate new key/i }).click()
    await page.getByLabel('Label').fill('ui-test revoke key')
    await page.getByRole('button', { name: 'Generate key' }).click()
    await expect(page.getByText(/Copy your key/i)).toBeVisible({ timeout: 10000 })
    const keyText = await page.locator('code').textContent()
    if (keyText) createdKeyPrefixes.push(keyText.slice(0, 8))
    await page.getByText(/Done.*saved/i).click()
    await expect(page.getByText('ui-test revoke key')).toBeVisible()

    // Click Revoke
    const revokeBtn = page.getByRole('button', { name: 'Revoke' }).last()
    await revokeBtn.click()
    await expect(page.getByText('Revoke?')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Yes' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'No' })).toBeVisible()

    // Click No — key should still be there
    await page.getByRole('button', { name: 'No' }).click()
    await expect(page.getByText('Revoke?')).not.toBeVisible()
    await expect(page.getByText('ui-test revoke key')).toBeVisible()
    await ctx.close()
  })

  test('Revoke → Yes permanently removes the key from the list', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: AUTH_STATE })
    const page = await ctx.newPage()
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')

    // Create a key
    await page.getByRole('button', { name: /generate new key/i }).click()
    await page.getByLabel('Label').fill('ui-test delete me')
    await page.getByRole('button', { name: 'Generate key' }).click()
    await expect(page.getByText(/Copy your key/i)).toBeVisible({ timeout: 10000 })
    await page.getByText(/Done.*saved/i).click()
    await expect(page.getByText('ui-test delete me')).toBeVisible()

    // Revoke it
    await page.getByRole('button', { name: 'Revoke' }).last().click()
    await page.getByRole('button', { name: 'Yes' }).click()

    // Key should be gone from the list
    await expect(page.getByText('ui-test delete me')).not.toBeVisible({ timeout: 10000 })
    await ctx.close()
  })
})
