// Network guard for the local test server (loaded with `node --require`, and
// through NODE_OPTIONS into every child process and worker thread).
//
// Isolation must not rest on intent or on environment variables alone, so this
// blocks at the lowest level Node offers and records every attempt:
//   - TCP/TLS: net.Socket.prototype.connect — the one method every client goes
//     through (http/https agents, undici/fetch, tls.connect, net.connect). Only
//     loopback hosts and local pipes are allowed.
//   - DNS: dns.lookup / dns.promises.lookup / every dns.resolve* and Resolver
//     method — only loopback names; anything else never leaves the process.
//   - UDP: dgram sockets may not send or connect to non-loopback addresses.
// A blocked attempt throws AND is appended to EQ_NET_GUARD_LOG; the Playwright
// run fails on any line in that file.
//
// It also refuses to run with real credentials: every key named in
// EQ_DUMMY_KEYS must hold a value starting with "eqtest" (or be empty), and no
// value may contain the production project reference. Next loads .env files
// after this script, so that check repeats after start-up and kills the process.
'use strict'
const net = require('node:net')
const dns = require('node:dns')
const dgram = require('node:dgram')
const fs = require('node:fs')

const LOG = process.env.EQ_NET_GUARD_LOG
if (!LOG) throw new Error('[net-guard] EQ_NET_GUARD_LOG is not set — refusing to start unguarded')

const LOOPBACK_NAMES = new Set(['localhost', 'localhost.'])
function isLoopback(host) {
  if (host === undefined || host === null || host === '') return true // Node's default: localhost
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, '')
  if (LOOPBACK_NAMES.has(h)) return true
  if (h === '::1' || h === '0:0:0:0:0:0:0:1') return true
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true
  if (/^::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true
  return false
}

function record(kind, host, port) {
  const line = JSON.stringify({ at: new Date().toISOString(), pid: process.pid, kind, host: String(host), port: port ?? null })
  try { fs.appendFileSync(LOG, line + '\n') } catch { /* the throw still blocks it */ }
  const err = new Error(`[net-guard] blocked ${kind} to ${host}${port ? ':' + port : ''}`)
  err.code = 'EQ_NET_GUARD'
  return err
}

// ── TCP / TLS ────────────────────────────────────────────────────────────
// Socket#connect(options[, cb]) | (port[, host][, cb]) | (path[, cb]) | ([options, cb]) (internal normalized form)
function connectTarget(args) {
  let a = args[0]
  if (Array.isArray(a)) a = a[0] // normalized internal call: [options, cb]
  if (a && typeof a === 'object') {
    if (a.path) return { local: true }
    return { host: a.host ?? a.hostname, port: a.port }
  }
  if (typeof a === 'string' && !/^\d+$/.test(a)) return { local: true } // pipe / unix socket
  return { host: typeof args[1] === 'string' ? args[1] : undefined, port: a }
}
const socketConnect = net.Socket.prototype.connect
net.Socket.prototype.connect = function guardedConnect(...args) {
  const t = connectTarget(args)
  if (!t.local && !isLoopback(t.host)) {
    const err = record('tcp', t.host, t.port)
    process.nextTick(() => this.destroy(err))
    return this
  }
  return socketConnect.apply(this, args)
}

// ── DNS ──────────────────────────────────────────────────────────────────
function guardDnsFn(holder, name, kind) {
  const original = holder[name]
  if (typeof original !== 'function') return
  holder[name] = function guardedDns(host, ...rest) {
    if (isLoopback(host)) return original.call(this, host, ...rest)
    const err = record(kind, host)
    const cb = rest[rest.length - 1]
    if (typeof cb === 'function') { process.nextTick(cb, err); return }
    throw err
  }
}
function guardDnsPromise(holder, name, kind) {
  const original = holder[name]
  if (typeof original !== 'function') return
  holder[name] = async function guardedDnsPromise(host, ...rest) {
    if (isLoopback(host)) return original.call(this, host, ...rest)
    throw record(kind, host)
  }
}
const RESOLVERS = ['resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCname', 'resolveCaa', 'resolveMx',
  'resolveNaptr', 'resolveNs', 'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTxt', 'reverse']
guardDnsFn(dns, 'lookup', 'dns')
guardDnsFn(dns, 'lookupService', 'dns')
guardDnsPromise(dns.promises, 'lookup', 'dns')
guardDnsPromise(dns.promises, 'lookupService', 'dns')
for (const r of RESOLVERS) {
  guardDnsFn(dns, r, 'dns-resolve')
  guardDnsPromise(dns.promises, r, 'dns-resolve')
  guardDnsFn(dns.Resolver.prototype, r, 'dns-resolve')
  guardDnsPromise(dns.promises.Resolver.prototype, r, 'dns-resolve')
}

// ── UDP ──────────────────────────────────────────────────────────────────
const udpSend = dgram.Socket.prototype.send
dgram.Socket.prototype.send = function guardedSend(...args) {
  // send(msg[, offset, length], port[, address][, cb]) — the address is the first string after the port
  const address = args.slice(1).find(a => typeof a === 'string')
  if (!isLoopback(address)) {
    const err = record('udp', address)
    const cb = args[args.length - 1]
    if (typeof cb === 'function') { process.nextTick(cb, err); return }
    throw err
  }
  return udpSend.apply(this, args)
}
const udpConnect = dgram.Socket.prototype.connect
dgram.Socket.prototype.connect = function guardedUdpConnect(port, address, ...rest) {
  if (!isLoopback(typeof address === 'string' ? address : undefined)) throw record('udp', address, port)
  return udpConnect.call(this, port, address, ...rest)
}

// ── Credentials ──────────────────────────────────────────────────────────
const PROD_REF = 'ubngpsdzjoeqfxfbdtxc'
const DUMMY_KEYS = (process.env.EQ_DUMMY_KEYS ?? '').split(',').filter(Boolean)
function checkEnv(stage) {
  const problems = []
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string' && v.includes(PROD_REF)) problems.push(`${k} holds the production project reference`)
  }
  for (const k of DUMMY_KEYS) {
    const v = process.env[k]
    if (v !== undefined && v !== '' && !String(v).startsWith('eqtest') && !/^http:\/\/127\.0\.0\.1:\d+$/.test(String(v))) {
      problems.push(`${k} is not a test value`)
    }
  }
  if (problems.length) {
    try { fs.appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), pid: process.pid, kind: 'env', stage, problems }) + '\n') } catch { /* exit anyway */ }
    console.error(`[net-guard] unsafe environment (${stage}): ${problems.join('; ')} — stopping`)
    process.exit(97)
  }
}
checkEnv('start')
for (const ms of [200, 1000, 3000, 10000, 30000]) setTimeout(() => checkEnv(`after ${ms} ms`), ms).unref()

module.exports = { isLoopback }
