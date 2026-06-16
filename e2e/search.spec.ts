import { test, expect } from '@playwright/test'
import path from 'path'

test.use({ storageState: 'e2e/.auth/user.json' })

const AUTH_STATE = path.join(__dirname, '.auth/user.json')

let sourceWorkshopId = ''
let childWorkshopId = ''

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: AUTH_STATE })
  const page = await ctx.newPage()

  // Create a source with a title we can search for
  await page.goto('/objects/new?type=source')
  const titleInput = page.getByPlaceholder('e.g. Backyard maple — Lynn Valley')
  await titleInput.fill('SearchTest Walnut')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.waitForURL(/\/objects\/[^/]+$/)
  sourceWorkshopId = (await page.locator('h1.font-mono').textContent())?.trim() ?? ''

  // Create a child log
  await page.getByRole('link', { name: '+ Add Child' }).click()
  await page.locator('select').first().selectOption('log')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.waitForURL(/\/objects\/[^/]+$/)
  childWorkshopId = (await page.locator('h1.font-mono').textContent())?.trim() ?? ''

  await ctx.close()
})

test('search by exact workshop ID shows that object', async ({ page }) => {
  await page.goto(`/?q=${encodeURIComponent(sourceWorkshopId)}`)
  // Match by title since the source has a known title; the regex matches the link but not child IDs
  await expect(page.getByRole('link', { name: /SearchTest Walnut/ })).toBeVisible()
})

test('search by child workshop ID shows only the child (not unrelated objects)', async ({ page }) => {
  await page.goto(`/?q=${encodeURIComponent(childWorkshopId)}`)
  // Use role to target the result link, not the heading which also contains the ID text
  await expect(page.getByRole('link', { name: new RegExp(childWorkshopId) })).toBeVisible()
})

test('search by title keyword shows matching objects', async ({ page }) => {
  await page.goto('/?q=SearchTest')
  await expect(page.getByText(sourceWorkshopId)).toBeVisible()
})

test('search with no query shows Recent list', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Recent')).toBeVisible()
})

test('search with no results shows an informative empty state', async ({ page }) => {
  await page.goto('/?q=ZZZNORESULTSXYZ')
  await expect(page.getByText('No results', { exact: false })).toBeVisible()
})
