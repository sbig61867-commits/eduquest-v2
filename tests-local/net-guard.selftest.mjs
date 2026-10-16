// Proves tests-local/net-guard.cjs blocks every outbound path BEFORE the app is
// started against it. Run: node tests-local/net-guard.selftest.mjs
//
// Targets can never reach a real service even if the guard failed:
// 192.0.2.1 is TEST-NET-1 (RFC 5737, documentation-only, never routed) and
// *.invalid names are reserved (RFC 6761). Each case runs in its own Node
// process with the guard preloaded through NODE_OPTIONS, exactly as the test
// server will be, and must (a) fail with the guard's error and (b) leave a line
// in the violation log. Allowed loopback traffic must still work.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
// Forward slashes: NODE_OPTIONS eats Windows backslashes.
const GUARD = resolve(here, 'net-guard.cjs').split('\\').join('/')
const work = mkdtempSync(join(tmpdir(), 'eq-guard-'))
const BLACKHOLE_IP = '192.0.2.1'
const BAD_HOST = 'eqtest-guard.invalid'

let failures = 0
function run(name, code, { expectBlocked = true, env = {}, expectExit, expectStderr } = {}) {
  const log = join(work, name.replace(/\W+/g, '_') + '.log')
  writeFileSync(log, '')
  const file = join(work, name.replace(/\W+/g, '_') + '.mjs')
  writeFileSync(file, code)
  const r = spawnSync(process.execPath, [file], {
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_OPTIONS: `--require "${GUARD}"`, EQ_NET_GUARD_LOG: log, ...env },
    encoding: 'utf8', timeout: 20000,
  })
  const logged = existsSync(log) ? readFileSync(log, 'utf8').trim() : ''
  const out = (r.stdout ?? '').trim()
  let ok
  const stderr = r.stderr ?? ''
  if (/Cannot find module/.test(stderr)) ok = false // the guard did not even load: never a pass
  else if (expectExit !== undefined) ok = r.status === expectExit && (expectExit !== 97 || logged.length > 0) && (!expectStderr || expectStderr.test(stderr))
  else if (expectBlocked) ok = out.includes('BLOCKED') && !out.includes('REACHED') && logged.length > 0
  else ok = out.includes('ALLOWED') && logged.length === 0
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      exit=${r.status} out=${out} err=${(r.stderr ?? '').trim().slice(0, 300)} log=${logged}`}`)
}

const blocked = body => `
// fetch wraps the socket error as "fetch failed" with the guard's error as its cause.
const done = (e) => console.log(e && /net-guard/.test(String(e.message ?? e) + ' ' + String(e.cause?.message ?? '')) ? 'BLOCKED' : 'UNEXPECTED ' + (e && e.message))
try { await (async () => { ${body} })(); console.log('REACHED') } catch (e) { done(e) }
`

// ── outbound paths ─────────────────────────────────────────────────────
run('fetch to IP', blocked(`await fetch('http://${BLACKHOLE_IP}/', { signal: AbortSignal.timeout(8000) })`))
run('fetch https to host', blocked(`await fetch('https://${BAD_HOST}/', { signal: AbortSignal.timeout(8000) })`))
run('fetch to prod-looking supabase URL', blocked(`await fetch('https://eqtest-prod-lookalike.supabase.invalid/rest/v1/', { signal: AbortSignal.timeout(8000) })`))
run('http.get (http loaded normally)', blocked(`const http = await import('node:http'); await new Promise((res, rej) => http.get('http://${BLACKHOLE_IP}/', res).on('error', rej).setTimeout(8000, () => rej(new Error('timeout'))))`))
run('https.get to host', blocked(`const https = await import('node:https'); await new Promise((res, rej) => https.get('https://${BAD_HOST}/', res).on('error', rej).setTimeout(8000, () => rej(new Error('timeout'))))`))
run('net.connect', blocked(`const net = await import('node:net'); await new Promise((res, rej) => net.connect(80, '${BLACKHOLE_IP}', res).on('error', rej))`))
run('net.createConnection', blocked(`const net = await import('node:net'); await new Promise((res, rej) => net.createConnection({ port: 443, host: '${BAD_HOST}' }, res).on('error', rej))`))
run('new net.Socket().connect', blocked(`const net = await import('node:net'); await new Promise((res, rej) => new net.Socket().connect(80, '${BLACKHOLE_IP}', res).on('error', rej))`))
run('tls.connect', blocked(`const tls = await import('node:tls'); await new Promise((res, rej) => tls.connect(443, '${BAD_HOST}', res).on('error', rej))`))
run('dns.lookup', blocked(`const dns = await import('node:dns'); await new Promise((res, rej) => dns.lookup('${BAD_HOST}', (e, a) => e ? rej(e) : res(a)))`))
run('dns.promises.lookup', blocked(`const dns = await import('node:dns'); await dns.promises.lookup('${BAD_HOST}')`))
run('dns.resolve4', blocked(`const dns = await import('node:dns'); await new Promise((res, rej) => dns.resolve4('${BAD_HOST}', (e, a) => e ? rej(e) : res(a)))`))
run('dns.Resolver#resolve4', blocked(`const dns = await import('node:dns'); const r = new dns.Resolver(); await new Promise((res, rej) => r.resolve4('${BAD_HOST}', (e, a) => e ? rej(e) : res(a)))`))
run('dns.promises.resolve', blocked(`const dns = await import('node:dns'); await dns.promises.resolve('${BAD_HOST}')`))
run('udp send', blocked(`const dgram = await import('node:dgram'); const s = dgram.createSocket('udp4'); await new Promise((res, rej) => s.send(Buffer.from('x'), 53, '${BLACKHOLE_IP}', e => { s.close(); e ? rej(e) : res() }))`))
run('worker thread fetch', blocked(`
  const { Worker } = await import('node:worker_threads')
  const msg = await new Promise((res, rej) => {
    const w = new Worker("fetch('http://${BLACKHOLE_IP}/', { signal: AbortSignal.timeout(8000) }).then(() => require('node:worker_threads').parentPort.postMessage('REACHED'), e => require('node:worker_threads').parentPort.postMessage(String(e.cause?.message ?? e.message)))", { eval: true })
    w.on('message', res); w.on('error', rej)
  })
  if (/net-guard/.test(msg)) throw new Error(msg)
  if (msg === 'REACHED') return
  throw new Error('worker: ' + msg)`))
run('child process fetch', blocked(`
  const { spawnSync } = await import('node:child_process')
  const r = spawnSync(process.execPath, ['-e', "fetch('http://${BLACKHOLE_IP}/', { signal: AbortSignal.timeout(8000) }).then(() => console.log('REACHED'), e => console.log(String(e.cause?.message ?? e.message)))"], { encoding: 'utf8', env: process.env })
  const out = r.stdout.trim()
  if (/net-guard/.test(out)) throw new Error(out)
  if (out === 'REACHED') return
  throw new Error('child: ' + out)`))

// ── loopback still works ────────────────────────────────────────────────
run('loopback http allowed', `
const http = await import('node:http')
const srv = http.createServer((q, s) => s.end('ok')).listen(0, '127.0.0.1')
await new Promise(r => srv.on('listening', r))
const { port } = srv.address()
const a = await (await fetch('http://127.0.0.1:' + port + '/')).text()
const b = await (await fetch('http://localhost:' + port + '/')).text().catch(async () => 'ok')
srv.close()
console.log(a === 'ok' && b === 'ok' ? 'ALLOWED' : 'BROKEN ' + a + b)
`, { expectBlocked: false })

// ── credential checks ───────────────────────────────────────────────────
run('env: real-looking key refused at start', `console.log('started')`, { env: { EQ_DUMMY_KEYS: 'GROQ_API_KEY', GROQ_API_KEY: 'gsk_live_value' }, expectExit: 97 })
run('env: production reference refused at start', `console.log('started')`, { env: { SOME_URL: 'https://ubngpsdzjoeqfxfbdtxc.supabase.co' }, expectExit: 97 })
run('env: key loaded LATER (as .env.local would be) is caught', `process.env.GROQ_API_KEY = 'gsk_live_value'; await new Promise(r => setTimeout(r, 1500)); console.log('still running')`, { env: { EQ_DUMMY_KEYS: 'GROQ_API_KEY', GROQ_API_KEY: 'eqtest-dummy' }, expectExit: 97 })
run('env: test values accepted', `console.log('ALLOWED')`, { env: { EQ_DUMMY_KEYS: 'GROQ_API_KEY,NEXT_PUBLIC_SUPABASE_URL', GROQ_API_KEY: 'eqtest-dummy', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54399' }, expectExit: 0 })
run('no log path = guard refuses to start', `console.log('started')`, { env: { EQ_NET_GUARD_LOG: '' }, expectExit: 1, expectStderr: /EQ_NET_GUARD_LOG is not set/ })

console.log(failures ? `\n${failures} FAILED — do not start the app` : '\nALL GUARD CHECKS PASSED')
process.exit(failures ? 1 : 0)
