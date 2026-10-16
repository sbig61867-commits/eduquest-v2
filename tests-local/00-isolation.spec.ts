// Runs first (file order): proves the isolation is in force, not assumed.
import { test, expect, APP_ORIGIN, IDS } from './fixtures'
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const PROD_REF = 'ubngpsdzjoeqfxfbdtxc'
// The only *.supabase.co text allowed in a bundle is text that exists VERBATIM in
// the @supabase packages themselves — their JSDoc examples ("xyzcompany",
// "project-id", "example"…), which dev bundles keep. Anything else (our code,
// our configuration) fails, and the production reference must not appear at all.
const SUPABASE_RE = /https:\/\/[a-z0-9-]+\.supabase\.co/g
function libraryAddresses(dir = 'node_modules/@supabase', found = new Set<string>()) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) libraryAddresses(p, found)
    else if (/\.(js|mjs|cjs|ts)$/.test(name)) for (const m of readFileSync(p, 'utf8').matchAll(SUPABASE_RE)) found.add(m[0])
  }
  return found
}

test('isolation · no production reference in the page or any script it loads', async ({ page }) => {
  const bodies: { url: string; text: string }[] = []
  page.on('response', async r => {
    const ct = r.headers()['content-type'] ?? ''
    if (r.url().startsWith(APP_ORIGIN) && /javascript|html|json/.test(ct)) bodies.push({ url: r.url(), text: await r.text().catch(() => '') })
  })
  await page.goto(`/teacher/lessons/${IDS.lesson}`)
  // Not 'networkidle': the dev server keeps its HMR connection open.
  await page.waitForLoadState('load')
  await page.waitForTimeout(3000)
  expect(bodies.length, 'the page and its scripts were captured').toBeGreaterThan(3)
  // Report the exact text matched, with context, so a hit can be judged on what it is.
  const leaks = bodies.flatMap(b => [...b.text.matchAll(new RegExp(`.{0,80}(${PROD_REF}|https://[a-z0-9-]+\\.supabase\\.co).{0,80}`, 'g'))]
    .map(m => ({ url: b.url, match: m[1], context: m[0].replace(/\s+/g, ' ') })))
  expect(leaks.filter(l => l.match === PROD_REF), 'the production project reference').toEqual([])
  const library = libraryAddresses()
  expect(library.size, 'read the @supabase packages').toBeGreaterThan(0)
  expect(leaks.filter(l => l.match !== PROD_REF && !library.has(l.match)), 'a *.supabase.co address not from the @supabase packages').toEqual([])
  expect(bodies.some(b => b.text.includes('127.0.0.1:54399')), 'the app is configured with the fake Supabase').toBe(true)
})

test('isolation · the OS monitor is scanning and watches the app server process', async () => {
  const status = await (await fetch('http://127.0.0.1:54398/status')).json() as { scans: number; pids: number[]; hits: unknown[] }
  expect(status.scans).toBeGreaterThan(2)
  expect(status.hits).toEqual([])
  const netstat = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' })
  const appPid = Number(netstat.split(/\r?\n/).find(l => /127\.0\.0\.1:3123\s+\S+\s+LISTENING/.test(l))?.trim().split(/\s+/).pop())
  const fakePid = Number(netstat.split(/\r?\n/).find(l => /127\.0\.0\.1:54399\s+\S+\s+LISTENING/.test(l))?.trim().split(/\s+/).pop())
  expect(appPid, 'found the process listening on the app port').toBeGreaterThan(0)
  // the tree is refreshed every ~2 s
  await expect.poll(async () => ((await (await fetch('http://127.0.0.1:54398/status')).json()) as { pids: number[] }).pids.includes(appPid), { timeout: 10_000 }).toBe(true)
  expect(status.pids.includes(fakePid) || fakePid === 0).toBe(true)
})
