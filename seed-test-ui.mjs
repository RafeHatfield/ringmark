import { chromium } from '@playwright/test'
import { readFileSync } from 'fs'

const authState = JSON.parse(readFileSync('./e2e/.auth/user.json', 'utf8'))

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  storageState: authState,
  viewport: { width: 390, height: 844 },
})
const page = await context.newPage()

// Check if authenticated by going to workshop
await page.goto('http://localhost:3000/workshop')
await page.waitForLoadState('networkidle')
console.log('Workshop URL:', page.url())

await page.screenshot({ path: '/tmp/workshop-check.png', fullPage: true })

await browser.close()
