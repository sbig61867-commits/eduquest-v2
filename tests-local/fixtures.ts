// Shared fixture for the isolated local tests (playwright.local.config.ts).
// Every test: a fresh fake database, a signed test session, the browser locked
// to the local app origin, and — after the test — a hard failure if ANY layer
// saw traffic that was not local (net-guard, os-monitor, fake Supabase, browser).
import { test as base, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

export const SUPABASE = 'http://127.0.0.1:54399'
export const APP_ORIGIN = 'http://127.0.0.1:3123'
const GUARD_LOG = 'tests-local/.out/net-guard.log'
const MONITOR_LOG = 'tests-local/.out/os-monitor.log'

export const IDS = {
  lesson: '44444444-4444-4444-8444-444444444444',
}

export interface FakeState {
  lesson: { content: string; title: string; is_published: boolean }
  updates: { at: number; body: Record<string, unknown> }[]
  requests: { method: string; path: string; query: string }[]
  violations: { method: string; url: string; why: string }[]
}

async function control<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${SUPABASE}${path}`, body === undefined ? undefined : { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
  if (!res.ok) throw new Error(`fake-supabase control ${path}: ${res.status}`)
  return res.json() as Promise<T>
}
/** Who the test is signed in as; null = no session at all. */
export type SignedInAs = { role: 'teacher' | 'student' | 'university_admin' | 'super_admin' | 'center_manager'; is_active?: boolean; live_is_active?: boolean } | null

export const fake = {
  reset: (lesson: Record<string, unknown> = {}, as: SignedInAs = { role: 'teacher' }) => control('/__eqtest/reset', { lesson, as: as ?? {} }),
  state: () => control<FakeState>('/__eqtest/state'),
  mode: (m: { lessonUpdate: 'ok' | 'error' | 'hold' }) => control('/__eqtest/mode', m),
  release: () => control('/__eqtest/release', {}),
}

const nonEmptyLines = (file: string) => {
  try { return readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean) } catch (e) { return [`cannot read ${file}: ${e}`] }
}

async function signIn(page: Page, locale: 'ar' | 'en', signedIn: boolean) {
  const cookies: { name: string; value: string; url: string; sameSite: 'Lax' }[] = []
  if (signedIn) {
    const session = await control<Record<string, unknown>>('/__eqtest/session')
    // @supabase/ssr storage key: sb-<first label of the Supabase host>-auth-token
    const value = 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url')
    cookies.push({ name: 'sb-127-auth-token', value, url: APP_ORIGIN, sameSite: 'Lax' })
  }
  await page.context().addCookies([
    ...cookies,
    { name: 'eq_locale', value: locale, url: APP_ORIGIN, sameSite: 'Lax' },
    { name: 'eq_theme', value: 'light', url: APP_ORIGIN, sameSite: 'Lax' },
  ])
}

// The ONE known, already-BLOCKED attempt that does not fail a test: `next dev`
// checks npm for a newer Next.js on start, unconditionally and with no switch
// (next/dist/server/dev/hot-reloader-webpack.js → getVersionInfo). It is not the
// app and not production, and net-guard refused it. It is still reported.
const KNOWN_BLOCKED = (line: string) => {
  try { const e = JSON.parse(line); return e.kind === 'tcp' && e.host === 'registry.npmjs.org' && e.port === 443 } catch { return false }
}
export const guardFindings = () => {
  const all = nonEmptyLines(GUARD_LOG)
  return { unexpected: all.filter(l => !KNOWN_BLOCKED(l)), knownBlocked: all.filter(KNOWN_BLOCKED) }
}

type Fixtures = { locale: 'ar' | 'en'; signedInAs: SignedInAs; isolated: void }

export const test = base.extend<Fixtures>({
  locale: async ({}, use, testInfo) => { await use(testInfo.project.metadata.locale as 'ar' | 'en') },

  // Default: the fixture teacher. A spec overrides it with test.use({ signedInAs: ... }).
  signedInAs: [{ role: 'teacher' }, { option: true }],

  isolated: [async ({ page, locale, signedInAs }, use) => {
    const guardBefore = guardFindings().unexpected
    const monitorBefore = nonEmptyLines(MONITOR_LOG)
    expect(guardBefore, 'net-guard saw a blocked attempt before this test').toEqual([])
    expect(monitorBefore, 'os-monitor saw a non-loopback connection before this test').toEqual([])

    const browserViolations: string[] = []
    // Browser: only the local app and the local fake Supabase (and inline data/blob).
    await page.route('**/*', route => {
      const url = route.request().url()
      if (url.startsWith(APP_ORIGIN) || url.startsWith(SUPABASE + '/') || url.startsWith('data:') || url.startsWith('blob:')) return route.fallback()
      browserViolations.push(`${route.request().method()} ${url}`)
      return route.abort('blockedbyclient')
    })
    await page.routeWebSocket(/.*/, ws => {
      if (ws.url().startsWith(APP_ORIGIN.replace('http', 'ws'))) { ws.connectToServer(); return }
      // (the fake Supabase has no realtime; a socket to it would be a violation too)
      browserViolations.push(`WS ${ws.url()}`)
      ws.close()
    })

    await fake.reset({}, signedInAs)
    await signIn(page, locale, signedInAs !== null)
    await use()

    const s = await fake.state()
    expect(s.violations, 'fake Supabase received a request it does not mock').toEqual([])
    expect(browserViolations, 'the browser tried to reach a non-local origin').toEqual([])
    expect(guardFindings().unexpected, 'net-guard blocked an outbound attempt during this test').toEqual([])
    expect(nonEmptyLines(MONITOR_LOG), 'os-monitor saw a non-loopback connection during this test').toEqual([])
  }, { auto: true }],
})

export { expect }
