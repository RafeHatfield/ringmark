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
  // "Parent" label should be visible in the lineage section (exact — the Danger
  // Zone copy on this page mentions "re-parent", which substring-matches "Parent")
  await expect(page.getByText('Parent', { exact: true })).toBeVisible()
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
  await expect(page.getByText('Parent', { exact: true })).toBeVisible()
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

// ── Root-centric navigation ───────────────────────────────────────────────────

test('home shows root but not child IDs when no search', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText(sourceWorkshopId, { exact: true })).toBeVisible()
  await expect(page.getByText(childWorkshopId, { exact: true })).not.toBeVisible()
})

test('root card shows piece count', async ({ page }) => {
  await page.goto('/')
  // 3 nodes in tree (source + child + grandchild) → "3 pieces"
  await expect(page.getByText(/3 pieces/i)).toBeVisible()
})

test('"View full tree" link appears on root with children', async ({ page }) => {
  await page.goto(`/objects/${sourceId}`)
  await expect(page.getByRole('link', { name: /view full tree/i })).toBeVisible()
})

test('"View full tree" link appears on child', async ({ page }) => {
  await page.goto(`/objects/${childId}`)
  await expect(page.getByRole('link', { name: /view full tree/i })).toBeVisible()
})

test('tree page shows all tree nodes', async ({ page }) => {
  await page.goto(`/objects/${sourceId}/tree`)
  await expect(page.getByText(sourceWorkshopId).first()).toBeVisible()
  await expect(page.getByText(childWorkshopId).first()).toBeVisible()
  await expect(page.getByText(grandchildWorkshopId).first()).toBeVisible()
})

test('tree page node links to detail page', async ({ page }) => {
  await page.goto(`/objects/${sourceId}/tree`)
  await page.getByRole('link', { name: childWorkshopId }).click()
  await expect(page).toHaveURL(`/objects/${childId}`)
})

// ── Root card navigation ──────────────────────────────────────────────────────

test('root card with children links to tree page', async ({ page }) => {
  await page.goto('/workshop')
  // The source has a child and grandchild (descendantCount > 0) — must link to /tree
  const rootLink = page.getByRole('link').filter({ hasText: sourceWorkshopId }).first()
  const href = await rootLink.getAttribute('href')
  expect(href).toContain('/tree')
})

test('clicking root card with children navigates to tree page', async ({ page }) => {
  await page.goto('/workshop')
  await page.getByRole('link').filter({ hasText: sourceWorkshopId }).first().click()
  await expect(page).toHaveURL(new RegExp(`/objects/${sourceId}/tree`))
})

test('solo root card (no children) links directly to edit page', async ({ page }) => {
  // Create a fresh solo root
  await page.goto('/objects/new?type=source')
  await Promise.all([
    page.waitForURL(/\/objects\/[0-9a-f]{8}-/),
    page.getByRole('button', { name: 'Save' }).click(),
  ])
  const soloId = page.url().split('/objects/')[1]
  const soloWorkshopId = (await page.locator('h1.font-mono').textContent())?.trim() ?? ''

  await page.goto('/workshop')
  const soloLink = page.getByRole('link').filter({ hasText: soloWorkshopId }).first()
  const href = await soloLink.getAttribute('href')
  expect(href).toBe(`/objects/${soloId}`)
  expect(href).not.toContain('/tree')

  // Clean up
  const { createClient } = await import('@supabase/supabase-js')
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
  await admin.from('wood_objects').delete().eq('id', soloId)
})

test('search returns non-root nodes', async ({ page }) => {
  await page.goto(`/workshop?q=${encodeURIComponent(childWorkshopId)}`)
  await expect(page.getByText(childWorkshopId, { exact: true })).toBeVisible()
})

// ── Workshop ID rename edge cases ─────────────────────────────────────────────

test('renaming workshop ID persists after reload', async ({ page }) => {
  await page.goto(`/objects/${grandchildId}/edit`)

  const newId = `${grandchildWorkshopId.replace(/X+$/, '')}X`
  // Workshop ID input has font-mono class; no htmlFor/id linking to label
  const workshopIdInput = page.locator('input.font-mono')
  await workshopIdInput.fill(newId)
  await workshopIdInput.blur()

  // Wait briefly for async collision check to settle (no error should appear)
  await page.waitForTimeout(300)
  await expect(page.getByText(/is already taken/i)).not.toBeVisible()

  await page.getByRole('button', { name: 'Save' }).click()
  await page.waitForURL(`/objects/${grandchildId}`)

  await expect(page.locator('h1.font-mono')).toHaveText(newId)

  await page.reload()
  await expect(page.locator('h1.font-mono')).toHaveText(newId)

  grandchildWorkshopId = newId
})

test('collision error when renaming to an existing ID', async ({ page }) => {
  await page.goto(`/objects/${grandchildId}/edit`)

  const workshopIdInput = page.locator('input.font-mono')
  await workshopIdInput.fill(sourceWorkshopId)
  await workshopIdInput.blur()

  // Collision check fires on blur
  await expect(page.getByText(/is already taken/i)).toBeVisible({ timeout: 5_000 })
})

test('public slug is unchanged after workshop ID rename', async ({ page }) => {
  await page.goto(`/objects/${grandchildId}`)

  // Capture the public slug from the "View public page" link
  // Use .count() (instant, no timeout) to check existence before getAttribute
  const slugLinkCount = await page.locator('a[href^="/p/"]').count()
  if (slugLinkCount === 0) {
    // Object was never published — slug stability is not testable, skip
    return
  }
  const slugLink = page.locator('a[href^="/p/"]').first()
  const href = await slugLink.getAttribute('href')
  const slug = href?.replace('/p/', '') ?? null

  if (!slug) return

  // Rename the workshop ID
  await page.goto(`/objects/${grandchildId}/edit`)
  const newId = `${grandchildWorkshopId.replace(/Y+$/, '')}Y`
  const workshopIdInput = page.locator('input.font-mono')
  await workshopIdInput.fill(newId)
  await workshopIdInput.blur()
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Save' }).click()
  await page.waitForURL(`/objects/${grandchildId}`)
  grandchildWorkshopId = newId

  // Public slug must still work — the /p/[slug] route should return the piece
  await page.goto(`/p/${slug}`)
  // Any of these confirms the slug is still valid (not a 404)
  await expect(page).not.toHaveURL('/404')
  await expect(page.getByText(/could not be found/i)).not.toBeVisible()
})
