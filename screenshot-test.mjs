import { chromium } from '@playwright/test'
import { readFileSync } from 'fs'

const authState = JSON.parse(readFileSync('./e2e/.auth/user.json', 'utf8'))

const browser = await chromium.launch()
const context = await browser.newContext({
  storageState: authState,
  viewport: { width: 390, height: 844 },
})
const page = await context.newPage()

// 1. Home
await page.goto('http://localhost:3000/')
await page.waitForLoadState('networkidle')
await page.screenshot({ path: '/tmp/home-roots.png', fullPage: true })
console.log('Home screenshot taken')

const rootLinks = page.locator('ul.divide-y a')
const count = await rootLinks.count()
console.log('Root cards visible:', count)

if (count > 0) {
  const firstHref = await rootLinks.first().getAttribute('href')
  console.log('First root link:', firstHref)

  await page.goto(`http://localhost:3000${firstHref}`)
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: '/tmp/detail-page.png', fullPage: true })
  console.log('Detail page screenshot taken')

  const treeLink = page.getByRole('link', { name: /view full tree/i })
  const treeLinkVisible = await treeLink.isVisible()
  console.log('"View full tree" link visible:', treeLinkVisible)

  if (treeLinkVisible) {
    const treeHref = await treeLink.getAttribute('href')
    console.log('Tree link href:', treeHref)
    await page.goto(`http://localhost:3000${treeHref}`)
    await page.waitForLoadState('networkidle')
    await page.screenshot({ path: '/tmp/tree-page.png', fullPage: true })
    console.log('Tree page screenshot taken')
  }
}

await browser.close()
