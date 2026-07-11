import { defineConfig, devices } from '@playwright/test'

const PROD_URL = 'https://eduquest-v2.vercel.app'

export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
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
