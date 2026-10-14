import { defineConfig, devices } from '@playwright/test'
import * as dotenv from 'dotenv'
import path from 'path'

// Load .env.local so env vars are available for global setup and the webServer
dotenv.config({ path: path.join(__dirname, '.env.local') })

// Override when something else holds port 3000: E2E_BASE_URL=http://localhost:3010 npx playwright test
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // single-user app — sequential avoids ID collision between suites
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Run firefox and mobile via --project flag; not in default local run (time cost)
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 12'] },
    },
  ],
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  webServer: {
    command: `PORT=${new URL(BASE_URL).port || 3000} npm run dev`,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
