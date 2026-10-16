import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'

// Outbound GET for a URL a user typed (the announcement link preview), guarded
// against server-side request forgery.
//
// The address check runs INSIDE the socket's DNS lookup, so the address that is
// checked is the address that is connected to. Checking first and then calling
// fetch() resolved the name twice — a DNS record with a short TTL could answer
// a public address to the check and an internal one to the connection (DNS
// rebinding). TLS still verifies the certificate against the real hostname.
// Redirects are never followed: node:http does not follow them at all.

/** Thrown when a host resolves (or is) a non-public address. */
export class BlockedAddressError extends Error {
  constructor() { super('blocked address') }
}

/** Expand an IPv6 address into its 8 16-bit groups; null if it is not one. */
function ipv6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase()
  const zone = s.indexOf('%')
  if (zone !== -1) s = s.slice(0, zone)
  // Trailing dotted IPv4 (::ffff:1.2.3.4) becomes two groups.
  const v4 = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/)
  if (v4) {
    const p = v4[2].split('.').map(Number)
    if (p.some(n => n > 255)) return null
    s = v4[1] + ((p[0] << 8) | p[1]).toString(16) + ':' + ((p[2] << 8) | p[3]).toString(16)
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const fill = 8 - head.length - tail.length
  if (halves.length === 2 ? fill < 1 : fill !== 0) return null
  const groups = [...head, ...Array(halves.length === 2 ? fill : 0).fill('0'), ...tail]
  if (groups.some(g => !/^[0-9a-f]{1,4}$/.test(g))) return null
  return groups.map(g => parseInt(g, 16))
}

function isBlockedV4(ip: string): boolean {
  const p = ip.split('.').map(Number)
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b, c] = p
  return (
    a === 0 || a === 10 || a === 127 ||                 // this-network, private, loopback
    (a === 100 && b >= 64 && b <= 127) ||               // CGNAT 100.64/10
    (a === 169 && b === 254) ||                         // link-local + cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||                // private 172.16/12
    (a === 192 && b === 168) ||                         // private 192.168/16
    (a === 192 && b === 0) ||                           // IETF assignments 192.0.0/24, TEST-NET-1 192.0.2/24
    (a === 192 && b === 88 && c === 99) ||              // 6to4 relay anycast
    (a === 198 && (b === 18 || b === 19)) ||            // benchmarking
    (a === 198 && b === 51 && c === 100) ||             // TEST-NET-2
    (a === 203 && b === 0 && c === 113) ||              // TEST-NET-3
    a >= 224                                            // multicast + reserved + broadcast
  )
}

/**
 * True for every address a link preview must never reach: private, loopback,
 * link-local, CGNAT, metadata, reserved — and the IPv6 forms that tunnel or
 * translate to IPv4 (mapped, NAT64, 6to4, Teredo), which are judged by the
 * IPv4 address they carry or blocked outright.
 */
export function isBlockedAddress(ip: string): boolean {
  const kind = isIP(ip.split('%')[0])
  if (kind === 4) return isBlockedV4(ip)
  if (kind !== 6) return true
  const g = ipv6Groups(ip)
  if (!g) return true
  const v4Of = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`
  const zeroUpTo = (n: number) => g.slice(0, n).every(x => x === 0)

  if (zeroUpTo(7) && (g[7] === 0 || g[7] === 1)) return true            // :: and ::1
  if (zeroUpTo(5) && g[5] === 0xffff) return isBlockedV4(v4Of(g[6], g[7])) // ::ffff:a.b.c.d (any notation)
  if (zeroUpTo(6)) return true                                            // ::a.b.c.d (deprecated IPv4-compatible)
  if (g[0] === 0x64 && g[1] === 0xff9b) return true                       // NAT64 64:ff9b::/96 and 64:ff9b:1::/48
  if (g[0] === 0x2002) return true                                        // 6to4 2002::/16
  if (g[0] === 0x2001 && g[1] === 0) return true                          // Teredo 2001::/32
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true                     // documentation 2001:db8::/32
  if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true // discard 100::/64
  if ((g[0] & 0xfe00) === 0xfc00) return true                             // unique-local fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return true                             // link-local fe80::/10
  if ((g[0] & 0xffc0) === 0xfec0) return true                             // site-local fec0::/10
  if ((g[0] & 0xff00) === 0xff00) return true                             // multicast ff00::/8
  return false
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void

/**
 * Socket lookup that resolves the name ONCE and refuses the connection unless
 * every answer is public. Passed to http(s).request as `lookup`, so the socket
 * connects to the very address checked here.
 */
export function guardedLookup(hostname: string, options: { all?: boolean } | number | undefined, callback: LookupCallback): void {
  dnsLookup(hostname, { all: true }, (err, addresses) => {
    if (err) return callback(err, [])
    if (addresses.length === 0 || addresses.some(a => isBlockedAddress(a.address))) {
      return callback(new BlockedAddressError() as NodeJS.ErrnoException, [])
    }
    if (typeof options === 'object' && options?.all) return callback(null, addresses)
    callback(null, addresses[0].address, addresses[0].family)
  })
}

export interface PublicFetchResult {
  status: number
  contentType: string
  /** At most `maxBytes` of the body (only read for a 2xx text/html answer). */
  body: Buffer
}

/**
 * GET `url` (http/https only) from a public address. Rejects with
 * BlockedAddressError for an internal target, and with other errors for
 * network / timeout failures — callers must not echo those to the client.
 */
export function fetchPublic(
  url: URL,
  { timeoutMs = 6000, maxBytes = 65536, headers = {} }: { timeoutMs?: number; maxBytes?: number; headers?: Record<string, string> } = {},
): Promise<PublicFetchResult> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return Promise.reject(new Error('unsupported protocol'))
  const host = url.hostname.replace(/^\[|\]$/g, '')
  // A literal IP never reaches the lookup hook, so it is checked here.
  if (isIP(host) && isBlockedAddress(host)) return Promise.reject(new BlockedAddressError())

  const request = url.protocol === 'https:' ? httpsRequest : httpRequest
  return new Promise((resolve, reject) => {
    const req = request(url, { method: 'GET', headers, lookup: guardedLookup, signal: AbortSignal.timeout(timeoutMs) }, (res: IncomingMessage) => {
      const status = res.statusCode ?? 0
      const contentType = String(res.headers['content-type'] ?? '')
      if (status < 200 || status >= 300 || !contentType.includes('text/html')) {
        res.resume()
        return resolve({ status, contentType, body: Buffer.alloc(0) })
      }
      const chunks: Buffer[] = []
      let total = 0
      res.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
        total += chunk.length
        if (total >= maxBytes) res.destroy()
      })
      const done = () => resolve({ status, contentType, body: Buffer.concat(chunks).subarray(0, maxBytes) })
      res.on('end', done)
      res.on('close', done)
      res.on('error', reject)
    })
    req.on('error', reject)
    req.end()
  })
}
