// LOCAL, ISOLATED Playwright run — never production.
//   npx playwright test -c playwright.local.config.ts
//
// The existing playwright.config.ts targets production; this one is separate.
// Isolation, in layers (each one alone would block a production call):
//   1. Every key found in .env.local (names only — values are never read into
//      the run) is overridden with a test value, and Next keeps a variable that
//      already exists in the process over the .env file's.
//   2. Supabase is tests-local/fake-supabase.mjs on 127.0.0.1.
//   3. tests-local/net-guard.cjs runs inside every server process (NODE_OPTIONS):
//      no TCP/TLS/DNS/UDP except loopback; real-looking keys stop the process.
//   4. tests-local/os-monitor.mjs (started FIRST) watches, with netstat, every process started
//      by this run (servers, workers, browser) for non-loopback connections.
//   5. In the browser, any request or WebSocket to a non-local origin is aborted.
// Any hit in layers 2–5 fails the run (tests-local/fixtures.ts).
import { defineConfig, devices } from '@playwright/test'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = __dirname
const OUT = join(ROOT, 'tests-local', '.out')
mkdirSync(OUT, { recursive: true })
export const GUARD_LOG = join(OUT, 'net-guard.log')
export const MONITOR_LOG = join(OUT, 'os-monitor.log')
// Workers re-import this file: only the main runner may reset the logs, or a
// worker starting mid-run would erase violations already recorded.
if (!process.env.TEST_WORKER_INDEX) {
  writeFileSync(GUARD_LOG, '')
  writeFileSync(MONITOR_LOG, '')
}

const APP_PORT = 3123
const SUPABASE_PORT = 54399
const SUPABASE_URL = `http://127.0.0.1:${SUPABASE_PORT}`

// Key NAMES from .env.local — the values are discarded on this line.
const envLocalKeys = (() => {
  try {
    return readFileSync(join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)
      .map(l => l.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1])
      .filter((k): k is string => !!k)
  } catch { return [] }
})()

const testEnv: Record<string, string> = Object.fromEntries(envLocalKeys.map(k => [k, `eqtest-dummy-${k.toLowerCase()}`]))
Object.assign(testEnv, {
  NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'eqtest-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'eqtest-service-role-key',
  NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${APP_PORT}`,
})
const dummyKeys = Object.keys(testEnv)
const guardPath = resolve(ROOT, 'tests-local', 'net-guard.cjs').split('\\').join('/')

const serverEnv: Record<string, string> = {
  ...testEnv,
  EQ_DUMMY_KEYS: dummyKeys.join(','),
  EQ_NET_GUARD_LOG: GUARD_LOG,
  EQ_FAKE_SUPABASE_PORT: String(SUPABASE_PORT),
  NODE_OPTIONS: `--require "${guardPath}"`,
  NEXT_TELEMETRY_DISABLED: '1',
  // next/font/google reads its responses from this file instead of fetching.
  NEXT_FONT_GOOGLE_MOCKED_RESPONSES: resolve(ROOT, 'tests-local', 'google-fonts-mock.cjs'),
}

const viewports = {
  desktop: { ...devices['Desktop Chrome'] },
  mobile: { ...devices['Pixel 7'] },
}

export default defineConfig({
  testDir: './tests-local',
  testMatch: /.*\.spec\.ts$/,
  outputDir: join(OUT, 'results'),
  timeout: 90_000,
  retries: 0,
  workers: 1, // one fake database, one scenario at a time
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${APP_PORT}`,
    headless: true,
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
    // The app's CSP (connect-src https://*.supabase.co) rightly refuses the fake
    // Supabase on http://127.0.0.1. The TEST browser ignores CSP so the page can
    // reach it; origins stay locked to the two loopback servers by fixtures.ts.
    // Consequence: these tests do not exercise the CSP itself.
    bypassCSP: true,
  },
  metadata: { supabaseUrl: SUPABASE_URL, guardLog: GUARD_LOG, monitorLog: MONITOR_LOG },
  projects: (['ar', 'en'] as const).flatMap(locale =>
    (['desktop', 'mobile'] as const).map(vp => ({
      name: `${locale}-${vp}`,
      use: { ...viewports[vp], locale: locale === 'ar' ? 'ar' : 'en-US' },
      metadata: { locale },
    })),
  ),
  webServer: [
    {
      // Starts before anything else; its own first netstat scan gates /health.
      command: 'node tests-local/os-monitor.mjs',
      url: 'http://127.0.0.1:54398/health',
      env: { ...serverEnv, EQ_RUNNER_PID: String(process.pid), EQ_MONITOR_LOG: MONITOR_LOG, EQ_MONITOR_PORT: '54398' },
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'pipe',
    },
    {
      command: 'node tests-local/fake-supabase.mjs',
      url: `${SUPABASE_URL}/__eqtest/health`,
      env: serverEnv,
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: 'pipe',
    },
    {
      // webpack, not Turbopack: Turbopack's native (Rust) code would fetch
      // next/font files outside Node, past net-guard. Next's own binary, not
      // `npx` (which contacts the npm registry).
      command: `node node_modules/next/dist/bin/next dev --webpack -H 127.0.0.1 -p ${APP_PORT}`,
      url: `http://127.0.0.1:${APP_PORT}/login`,
      env: serverEnv,
      reuseExistingServer: false,
      timeout: 600_000,
      stdout: 'pipe',
    },
  ],
})
