import { chromium } from '@playwright/test'
import * as dotenv from 'dotenv'
import path from 'path'
import { ensureTestUser, TEST_EMAIL, TEST_PASSWORD } from './helpers/supabase-admin'

dotenv.config({ path: path.join(process.cwd(), '.env.local') })

export default async function globalSetup() {
  await ensureTestUser()

  const browser = await chromium.launch()
  const page = await browser.newPage()

  await page.goto('http://localhost:3000/auth')
  await page.fill('#email', TEST_EMAIL)
  await page.fill('#password', TEST_PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL('http://localhost:3000/')

  await page.context().storageState({ path: 'e2e/.auth/user.json' })
  await browser.close()

  console.log('  ✓ E2E test user ready and auth state saved')
}
