// OS-level network monitor for the local test run (Windows; Node core only).
//
// Independent of net-guard (which lives inside Node): this asks the operating
// system, via `netstat -ano`, for every TCP connection of every process started
// by the Playwright run — the fake Supabase, `next dev` and its workers, and the
// browser — and records any whose remote address is not loopback. It starts
// FIRST (the first webServer entry), before Next is launched.
//
// Env: EQ_RUNNER_PID (the Playwright runner), EQ_MONITOR_LOG, EQ_MONITOR_PORT.
// GET /health → ok once the first scan has run; GET /status → {scans, hits}.
import http from 'node:http'
import { execFile } from 'node:child_process'
import { appendFileSync, writeFileSync } from 'node:fs'

const RUNNER = Number(process.env.EQ_RUNNER_PID)
const LOG = process.env.EQ_MONITOR_LOG
const PORT = Number(process.env.EQ_MONITOR_PORT ?? 54398)
if (!RUNNER || !LOG) { console.error('[os-monitor] EQ_RUNNER_PID / EQ_MONITOR_LOG missing'); process.exit(2) }
writeFileSync(LOG, '')

const run = (cmd, args) => new Promise((res, rej) =>
  execFile(cmd, args, { windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (e, out) => (e ? rej(e) : res(out))))

let tree = new Set([RUNNER])
async function refreshTree() {
  const csv = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId),$($_.ParentProcessId),$($_.Name)" }'])
  const children = new Map()
  for (const line of csv.split(/\r?\n/)) {
    const [pid, ppid] = line.split(',').map(Number)
    if (!pid) continue
    if (!children.has(ppid)) children.set(ppid, [])
    children.get(ppid).push(pid)
  }
  const next = new Set([RUNNER])
  const stack = [RUNNER]
  while (stack.length) for (const c of children.get(stack.pop()) ?? []) if (!next.has(c)) { next.add(c); stack.push(c) }
  tree = next
}

const LOOPBACK = /^(127\.\d+\.\d+\.\d+|\[::1\]|\[::ffff:127\.\d+\.\d+\.\d+\]|0\.0\.0\.0|\[::\]|\*)(:|$)/
let scans = 0
const hits = []
const seen = new Set()
async function scan() {
  const out = await run('netstat', ['-ano', '-p', 'TCP']).catch(() => '')
  const out6 = await run('netstat', ['-ano', '-p', 'TCPv6']).catch(() => '')
  for (const line of (out + '\n' + out6).split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/)
    if (cols.length < 5 || !/^TCP/i.test(cols[0])) continue
    const [, , remote, stateName, pidText] = cols
    const pid = Number(pidText)
    if (!tree.has(pid) || stateName === 'LISTENING' || LOOPBACK.test(remote)) continue
    const key = `${pid} ${remote} ${stateName}`
    if (seen.has(key)) continue
    seen.add(key)
    const hit = { at: new Date().toISOString(), pid, remote, state: stateName }
    hits.push(hit)
    appendFileSync(LOG, JSON.stringify(hit) + '\n')
    console.error('[os-monitor] NON-LOOPBACK CONNECTION', hit)
  }
  scans++
}

let tick = 0
async function loop() {
  try {
    if (tick % 3 === 0) await refreshTree()
    await scan()
  } catch (e) { appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), monitorError: String(e) }) + '\n') }
  tick++
  setTimeout(loop, 700)
}
await refreshTree()
await scan()
loop()

http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json')
  if (req.url === '/health') return res.end(JSON.stringify({ ok: scans > 0 }))
  if (req.url === '/status') return res.end(JSON.stringify({ scans, watched: tree.size, pids: [...tree], hits }))
  res.statusCode = 404; res.end('{}')
}).listen(PORT, '127.0.0.1', () => console.log(`[os-monitor] watching runner ${RUNNER} on 127.0.0.1:${PORT}`))
