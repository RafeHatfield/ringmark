/**
 * Workshop flow: source creation → child (log) → grandchild (blank) → transform.
 *
 * The beforeAll creates the object tree via the UI so the navigation and
 * form submission paths are exercised as part of the setup.
 */
import { test, expect } from '@playwright/test'
import path from 'path'

test.use({ storageState: 'e2e/.auth/user.json' })

const AUTH_STATE = path.join(__dirname, '.auth/user.json')

let sourceId = ''
let sourceWorkshopId = ''
let childId = ''
let childWorkshopId = ''
let grandchildId = ''
let grandchildWorkshopId = ''

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: AUTH_STATE })
  const page = await ctx.newPage()

  // ── Create source ──────────────────────────────────────────────────────────
  await page.goto('/objects/new?type=source')
  // Set up waitForURL BEFORE clicking so the listener is ready before navigation fires.
  // The regex must NOT match /objects/new — use a UUID pattern.
  await Promise.all([
    page.waitForURL(/\/objects\/[0-9a-f]{8}-/),
    page.getByRole('button', { name: 'Save' }).click(),
  ])

  sourceId = page.url().split('/objects/')[1]
  sourceWorkshopId = (await page.locator('h1.font-mono').textContent())?.trim() ?? ''
  expect(sourceWorkshopId).toMatch(/^[A-Z]{2}\d+$/) // e.g. "RH1"

  // ── Create child (log) from source ─────────────────────────────────────────
  await page.getByRole('link', { name: '+ Add Child' }).click()
  await page.waitForURL(/\/child\/new/)
  await page.locator('select').first().selectOption('log')
  // Full UUID regex with $ anchor so /objects/${uuid}/child/new doesn't match prematurely
  await Promise.all([
    page.waitForURL(/\/objects\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
    page.getByRole('button', { name: 'Save' }).click(),
  ])

  childId = page.url().split('/objects/')[1]
  childWorkshopId = (await page.locator('h1.font-mono').textContent())?.trim() ?? ''

  // ── Create grandchild (blank) from child ───────────────────────────────────
  await page.getByRole('link', { name: '+ Add Child' }).click()
  await page.waitForURL(/\/child\/new/)
  await page.locator('select').first().selectOption('blank')
  await Promise.all([
    page.waitForURL(/\/objects\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
    page.getByRole('button', { name: 'Save' }).click(),
  ])

  grandchildId = page.url().split('/objects/')[1]
  grandchildWorkshopId = (await page.locator('h1.font-mono').textContent())?.trim() ?? ''

  await ctx.close()
})

// ── Home page ────────────────────────────────────────────────────────────────

test('home page loads with a single Add button', async ({ page }) => {
  await page.goto('/workshop')
  await expect(page.getByRole('link', { name: '+ Add' })).toBeVisible()
  await expect(page.getByRole('link', { name: '+ Add Source' })).not.toBeVisible()
  await expect(page.getByRole('link', { name: '+ Add Object' })).not.toBeVisible()
})

test('created source appears in the Recent list', async ({ page }) => {
  await page.goto('/workshop')
  // exact:true matches only the workshop_id span (not child IDs like RH1-1 which contain the prefix)
  await expect(page.getByText(sourceWorkshopId, { exact: true })).toBeVisible()
})

// ── Source detail ────────────────────────────────────────────────────────────

test('source detail page shows workshop ID in heading', async ({ page }) => {
  await page.goto(`/objects/${sourceId}`)
  await expect(page.locator('h1.font-mono')).toHaveText(sourceWorkshopId)
})

test('source detail page shows the child in lineage', async ({ page }) => {
  await page.goto(`/objects/${sourceId}`)
  await expect(page.getByText(childWorkshopId)).toBeVisible()
})

// ── Child (log) detail ───────────────────────────────────────────────────────

test('child detail page shows parent in lineage section', async ({ page }) => {
  await page.goto(`/objects/${childId}`)
  // The parent appears as a link with exact text (child/grandchild IDs also contain the prefix)
  await expect(page.getByRole('link', { name: sourceWorkshopId, exact: true })).toBeVisible()
  // "Parent" label should be visible in the lineage section
  await expect(page.getByText('Parent')).toBeVisible()
})

// ── Flat ID invariant ────────────────────────────────────────────────────────

test('grandchild ID is flat under root — not a nested path', async ({ page }) => {
  await page.goto(`/objects/${grandchildId}`)
  const heading = (await page.locator('h1.font-mono').textContent())?.trim() ?? ''

  // Flat: "RH1-2" — at most one hyphen (root-suffix)
  // NOT nested: "RH1-1-1" (two or more hyphens)
  const hyphens = (heading.match(/-/g) ?? []).length
  expect(hyphens).toBeLessThanOrEqual(1)
})

test('grandchild lineage shows correct parent (child, not source)', async ({ page }) => {
  await page.goto(`/objects/${grandchildId}`)
  await expect(page.getByText('Parent')).toBeVisible()
  await expect(page.getByText(childWorkshopId)).toBeVisible()
})

// ── Transform ────────────────────────────────────────────────────────────────

test('editing type and status on the same record (transform, no new ID)', async ({ page }) => {
  await page.goto(`/objects/${grandchildId}/edit`)

  // Change type to rough_bowl
  const typeSelect = page.locator('select').first()
  await typeSelect.selectOption('rough_bowl')

  // Change status to rough_turned
  const statusSelect = page.locator('select').nth(1)
  await statusSelect.selectOption('rough_turned')

  await page.getByRole('button', { name: 'Save' }).click()
  await page.waitForURL(`/objects/${grandchildId}`)

  // ID must not have changed
  await expect(page.locator('h1.font-mono')).toHaveText(grandchildWorkshopId)

  // Status is a <select> (StatusChanger) — check its value, not visible text
  await expect(page.getByRole('combobox')).toHaveValue('rough_turned')
})
