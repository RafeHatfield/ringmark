import { test, expect } from '@playwright/test'
import path from 'path'

test.use({ storageState: 'e2e/.auth/user.json' })

const AUTH_STATE = path.join(__dirname, '.auth/user.json')

let objectId = ''
let workshopId = ''

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: AUTH_STATE })
  const page = await ctx.newPage()

  await page.goto('/objects/new?type=source')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.waitForURL(/\/objects\/[^/]+$/)

  objectId = page.url().split('/objects/')[1]
  workshopId = (await page.locator('h1.font-mono').textContent())?.trim() ?? ''

  await ctx.close()
})

test('delete button is visible in the Danger Zone section', async ({ page }) => {
  await page.goto(`/objects/${objectId}`)
  await expect(page.getByText('Danger Zone')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Delete object' })).toBeVisible()
})

test('first tap shows confirmation state, not immediate deletion', async ({ page }) => {
  await page.goto(`/objects/${objectId}`)

  await page.getByRole('button', { name: 'Delete object' }).click()

  // Confirm button and Cancel must appear
  await expect(page.getByRole('button', { name: 'Yes, delete permanently' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible()

  // Original delete button must be gone
  await expect(page.getByRole('button', { name: 'Delete object' })).not.toBeVisible()

  // URL must not have changed — no deletion yet
  await expect(page).toHaveURL(`/objects/${objectId}`)
})

test('Cancel returns to the normal delete button without deleting', async ({ page }) => {
  await page.goto(`/objects/${objectId}`)

  await page.getByRole('button', { name: 'Delete object' }).click()
  await page.getByRole('button', { name: 'Cancel' }).click()

  // Back to the original state
  await expect(page.getByRole('button', { name: 'Delete object' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Yes, delete permanently' })).not.toBeVisible()

  // Still on the same page (object exists)
  await expect(page).toHaveURL(`/objects/${objectId}`)
})

test('confirming deletion removes the object and redirects home', async ({ page }) => {
  await page.goto(`/objects/${objectId}`)

  await page.getByRole('button', { name: 'Delete object' }).click()
  await page.getByRole('button', { name: 'Yes, delete permanently' }).click()

  // Should land on home
  await page.waitForURL('/')
  await expect(page).toHaveURL('/')
})

test('deleted object no longer appears in search results', async ({ page }) => {
  await page.goto(`/?q=${encodeURIComponent(workshopId)}`)
  // Either "No results" or the object simply doesn't appear
  const objectLink = page.getByRole('link', { name: new RegExp(workshopId) })
  await expect(objectLink).not.toBeVisible()
})

test('navigating directly to deleted object shows not-found page', async ({ page }) => {
  await page.goto(`/objects/${objectId}`)
  // Should show not-found, not crash
  await expect(page.getByText('not found', { exact: false })).toBeVisible()
})
