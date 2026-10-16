/**
 * Security — src/lib/public-fetch.ts, the SSRF-guarded outbound GET behind the
 * announcement link preview.
 *
 *  A  isBlockedAddress: every private / reserved / tunnelled form, in every
 *     notation, is refused; ordinary public addresses pass.
 *  B  guardedLookup: the address checked is the address handed to the socket.
 *     A name that answered a public address to an earlier check and answers an
 *     internal one now (DNS rebinding) is refused at connect time.
 *  C  fetchPublic end to end against a real local server: a host resolving to
 *     loopback never reaches it.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

// node:dns is mocked so lookups are hermetic and scriptable per test.
type DnsAnswer = { address: string; family: number }[]
let dnsAnswer: DnsAnswer | Error = []
vi.mock('node:dns', () => {
  const lookup = (_host: string, _opts: unknown, cb: (err: Error | null, a: DnsAnswer) => void) => {
    if (dnsAnswer instanceof Error) cb(dnsAnswer, [])
    else cb(null, dnsAnswer)
  }
  return { lookup, default: { lookup } }
})

import { BlockedAddressError, fetchPublic, guardedLookup, isBlockedAddress } from '@/lib/public-fetch'

describe('A — isBlockedAddress', () => {
  it.each([
    // IPv4
    '0.0.0.0', '10.0.0.5', '127.0.0.1', '100.64.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255',
    '192.168.1.1', '192.0.0.8', '192.0.2.1', '192.88.99.1', '198.18.0.1', '198.51.100.7', '203.0.113.9',
    '224.0.0.1', '255.255.255.255',
    // IPv6 loopback / unspecified, in long and short forms
    '::', '::1', '0:0:0:0:0:0:0:1',
    // IPv4-mapped, dotted and hex (the URL parser emits the hex form)
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '0:0:0:0:0:ffff:10.0.0.1',
    // deprecated IPv4-compatible
    '::10.0.0.1',
    // NAT64, 6to4, Teredo, documentation, discard
    '64:ff9b::a9fe:a9fe', '64:ff9b:1::1', '2002:a9fe:a9fe::', '2001:0:4136:e378::1', '2001:db8::1', '100::1',
    // unique-local, link-local (with zone), site-local, multicast
    'fc00::1', 'fd12:3456::1', 'fe80::1', 'fe80::1%eth0', 'fec0::1', 'ff02::1',
    // garbage is refused, never treated as public
    'not-an-ip', '999.1.1.1', '1::2::3',
  ])('blocks %s', ip => {
    expect(isBlockedAddress(ip)).toBe(true)
  })

  it.each(['93.184.216.34', '8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1', '2606:4700:4700::1111', '2a00:1450:4001::64', '::ffff:93.184.216.34'])(
    'allows public %s',
    ip => { expect(isBlockedAddress(ip)).toBe(false) },
  )
})

const lookupOnce = (options: { all?: boolean }) =>
  new Promise<{ err: Error | null; address: unknown; family?: number }>(resolve =>
    guardedLookup('rebind.example', options, (err, address, family) => resolve({ err, address, family })))

describe('B — guardedLookup (connect-time check)', () => {
  beforeEach(() => { dnsAnswer = [] })

  it('passes a public answer through, single and all forms', async () => {
    dnsAnswer = [{ address: '93.184.216.34', family: 4 }]
    expect(await lookupOnce({})).toMatchObject({ err: null, address: '93.184.216.34', family: 4 })
    expect(await lookupOnce({ all: true })).toMatchObject({ err: null, address: [{ address: '93.184.216.34', family: 4 }] })
  })

  it('refuses when the name now answers an internal address (rebinding)', async () => {
    dnsAnswer = [{ address: '169.254.169.254', family: 4 }]
    const { err } = await lookupOnce({})
    expect(err).toBeInstanceOf(BlockedAddressError)
  })

  it('refuses when ANY answer is internal', async () => {
    dnsAnswer = [{ address: '93.184.216.34', family: 4 }, { address: '::1', family: 6 }]
    expect((await lookupOnce({ all: true })).err).toBeInstanceOf(BlockedAddressError)
  })

  it('refuses an empty answer and passes DNS errors through', async () => {
    expect((await lookupOnce({})).err).toBeInstanceOf(BlockedAddressError)
    dnsAnswer = new Error('ENOTFOUND')
    expect((await lookupOnce({})).err?.message).toBe('ENOTFOUND')
  })
})

describe('C — fetchPublic end to end', () => {
  let server: Server
  let hits = 0
  let port = 0

  beforeEach(async () => {
    if (server) return
    server = createServer((_req, res) => { hits++; res.setHeader('content-type', 'text/html'); res.end('<title>internal</title>') })
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()))
    port = (server.address() as AddressInfo).port
  })
  afterAll(() => new Promise<void>(r => (server ? server.close(() => r()) : r())))

  it('never connects when the host resolves to loopback', async () => {
    dnsAnswer = [{ address: '127.0.0.1', family: 4 }]
    await expect(fetchPublic(new URL(`http://rebind.example:${port}/`))).rejects.toBeInstanceOf(BlockedAddressError)
    expect(hits).toBe(0)
  })

  it('refuses a literal internal IP without any lookup', async () => {
    await expect(fetchPublic(new URL(`http://127.0.0.1:${port}/`))).rejects.toBeInstanceOf(BlockedAddressError)
    await expect(fetchPublic(new URL('http://[::ffff:127.0.0.1]/'))).rejects.toBeInstanceOf(BlockedAddressError)
    expect(hits).toBe(0)
  })

  it('refuses non-http schemes', async () => {
    await expect(fetchPublic(new URL('file:///etc/passwd'))).rejects.toThrow('unsupported protocol')
  })
})
