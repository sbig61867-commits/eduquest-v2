import { defineConfig, devices } from '@playwright/test'

const PROD_URL = 'https://eduquest-v2-afkwfqete-sbig61867-commits-projects.vercel.app'

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  retries: 1,
  use: {
    baseURL: PROD_URL,
    headless: true,
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
