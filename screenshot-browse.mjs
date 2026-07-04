import { chromium } from '@playwright/test'
import { readFileSync } from 'fs'

const authState = JSON.parse(readFileSync('./e2e/.auth/user.json', 'utf8'))

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  storageState: authState,
  viewport: { width: 390, height: 844 },
})
const page = await context.newPage()

async function createRoot(title) {
  await page.goto('http://localhost:3000/objects/new?type=source')
  await page.waitForLoadState('networkidle')
  // Visible inputs: [0] Workshop ID, [1] Title, [2] Species
  await page.locator('input:visible').nth(1).fill(title)
  await Promise.all([
    page.waitForURL(/\/objects\/[0-9a-f]{8}-/),
    page.getByRole('button', { name: 'Save' }).click(),
  ])
  const id = page.url().split('/objects/')[1]
  const wid = (await page.locator('h1.font-mono').textContent())?.trim()
  return { id, wid }
}

async function addChild(parentId, type) {
  await page.goto(`http://localhost:3000/objects/${parentId}`)
  await page.waitForLoadState('networkidle')
  await page.getByRole('link', { name: '+ Add Child' }).click()
  await page.waitForURL(/\/child\/new/)
  await page.locator('select').first().selectOption(type)
  await page.waitForTimeout(200)
  await Promise.all([
    page.waitForURL(/\/objects\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
    page.getByRole('button', { name: 'Save' }).click(),
  ])
  return page.url().split('/objects/')[1]
}

const r1 = await createRoot('Stanley Park Maple Burl')
console.log(`Root 1: ${r1.wid}`)
const c1 = await addChild(r1.id, 'blank')
console.log(`  Child 1`)
await addChild(c1, 'finished_bowl')
console.log(`  Grandchild`)
await addChild(r1.id, 'blank')
console.log(`  Child 2`)

const r2 = await createRoot('Red Oak Slab')
console.log(`Root 2: ${r2.wid}`)
await addChild(r2.id, 'log')
console.log(`  Child`)

// Screenshots
await page.goto('http://localhost:3000/workshop')
await page.waitForLoadState('networkidle')
await page.screenshot({ path: '/tmp/ui-home.png', fullPage: true })
console.log('✓ Home')

await page.goto(`http://localhost:3000/objects/${r1.id}`)
await page.waitForLoadState('networkidle')
await page.screenshot({ path: '/tmp/ui-detail.png', fullPage: true })
console.log('✓ Detail')

await page.goto(`http://localhost:3000/objects/${r1.id}/tree`)
await page.waitForLoadState('networkidle')
await page.screenshot({ path: '/tmp/ui-tree.png', fullPage: true })
console.log('✓ Tree')

await browser.close()
