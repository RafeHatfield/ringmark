import { chromium } from '@playwright/test'
import * as dotenv from 'dotenv'
import path from 'path'
import {
  ensureTestUser,
  ensureSecondTestUser,
  TEST_EMAIL,
  TEST_PASSWORD,
  OTHER_TEST_EMAIL,
  OTHER_TEST_PASSWORD,
} from './helpers/supabase-admin'

dotenv.config({ path: path.join(process.cwd(), '.env.local') })

export default async function globalSetup() {
  await ensureTestUser()
  await ensureSecondTestUser()

  const browser = await chromium.launch()

  // Save primary test user auth state
  const page1 = await browser.newPage()
  await page1.goto('http://localhost:3000/login')
  await page1.fill('#email', TEST_EMAIL)
  await page1.fill('#password', TEST_PASSWORD)
  await page1.click('button[type="submit"]')
  await page1.waitForURL('http://localhost:3000/workshop')
  await page1.context().storageState({ path: 'e2e/.auth/user.json' })
  await page1.close()

  // Save secondary test user auth state (used for non-owner access tests)
  const page2 = await browser.newPage()
  await page2.goto('http://localhost:3000/login')
  await page2.fill('#email', OTHER_TEST_EMAIL)
  await page2.fill('#password', OTHER_TEST_PASSWORD)
  await page2.click('button[type="submit"]')
  await page2.waitForURL('http://localhost:3000/workshop')
  await page2.context().storageState({ path: 'e2e/.auth/other-user.json' })
  await page2.close()

  await browser.close()
  console.log('  ✓ E2E test users ready and auth states saved')
}
