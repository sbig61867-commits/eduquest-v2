// Server-side URL guard for the one place the platform fetches a URL a user
// typed: the announcement link-preview.
//
// Authentication does NOT prevent SSRF — it only decides who can trigger it.
// Any signed-in student could previously make the server fetch an arbitrary
// address and read back the response, which reaches anything the serverless
// function can reach: cloud metadata endpoints, loopback services, and the
// private network the database sits on.
//
// Three defences, because any one alone is bypassable:
//   1. Only http/https, and no credentials, in the URL the user supplied.
//   2. Every hop is resolved to its IP addresses and rejected if ANY of them
//      is private, loopback, link-local, or otherwise not public routable.
//      Resolving is what stops a public hostname with a private A record.
//   3. Redirects are followed manually, one hop at a time, re-checking each
//      Location. `redirect: 'follow'` would let a public URL 302 straight to
//      169.254.169.254 after the first check passed.

import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BlockedUrlError'
  }
}

/**
 * Is this literal IP address outside the publicly routable space?
 * Covers the ranges an SSRF actually aims at, in both IPv4 and IPv6.
 */
export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip)
  if (kind === 0) return true // not an IP at all — treat as unsafe

  if (kind === 4) {
    const p = ip.split('.').map(Number)
    if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true
    const [a, b] = p
    if (a === 0) return true                        // 0.0.0.0/8 "this network"
    if (a === 10) return true                       // private
    if (a === 127) return true                      // loopback
    if (a === 169 && b === 254) return true         // link-local incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true // private
    if (a === 192 && b === 168) return true         // private
    if (a === 192 && b === 0) return true           // IETF protocol assignments
    if (a === 100 && b >= 64 && b <= 127) return true // carrier-grade NAT
    if (a === 198 && (b === 18 || b === 19)) return true // benchmarking
    if (a >= 224) return true                       // multicast + reserved + broadcast
    return false
  }

  // IPv6
  const v6 = ip.toLowerCase().split('%')[0] // strip any zone index
  if (v6 === '::' || v6 === '::1') return true              // unspecified, loopback
  if (v6.startsWith('fe8') || v6.startsWith('fe9')) return true // link-local
  if (v6.startsWith('fea') || v6.startsWith('feb')) return true
  if (v6.startsWith('fc') || v6.startsWith('fd')) return true   // unique local
  if (v6.startsWith('ff')) return true                          // multicast
  // IPv4-mapped (::ffff:10.0.0.1) and IPv4-compatible — check the embedded v4.
  const embedded = v6.match(/(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (embedded) return isPrivateAddress(embedded[1])
  return false
}

/** Reject a hostname whose DNS resolution points anywhere private. */
async function assertPublicHost(rawHostname: string): Promise<void> {
  // URL.hostname keeps the brackets around an IPv6 literal ("[::1]"), which
  // is not a valid IP string — without stripping them the address falls
  // through to the DNS path and a loopback target slips past.
  const hostname = rawHostname.startsWith('[') && rawHostname.endsWith(']')
    ? rawHostname.slice(1, -1)
    : rawHostname

  // A literal IP needs no lookup — check it directly.
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new BlockedUrlError('العنوان يشير إلى شبكة داخلية')
    }
    return
  }

  const lower = hostname.toLowerCase()
  if (lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.internal') || lower.endsWith('.local')) {
    throw new BlockedUrlError('العنوان يشير إلى شبكة داخلية')
  }

  let records: Array<{ address: string }>
  try {
    records = await lookup(hostname, { all: true })
  } catch {
    throw new BlockedUrlError('تعذّر التحقق من اسم النطاق')
  }
  if (records.length === 0) throw new BlockedUrlError('تعذّر التحقق من اسم النطاق')
  // ALL addresses must be public: one private record is enough to abuse.
  for (const r of records) {
    if (isPrivateAddress(r.address)) {
      throw new BlockedUrlError('العنوان يشير إلى شبكة داخلية')
    }
  }
}

/** Parse and validate a user-supplied URL, or throw BlockedUrlError. */
export async function assertFetchableUrl(raw: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new BlockedUrlError('رابط غير صالح')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlockedUrlError('يجب أن يبدأ الرابط بـ http:// أو https://')
  }
  // Credentials in a URL are only ever used to smuggle a host past a check.
  if (url.username || url.password) {
    throw new BlockedUrlError('رابط غير صالح')
  }
  await assertPublicHost(url.hostname)
  return url
}

export interface SafeFetchOptions {
  timeoutMs?: number
  maxRedirects?: number
  headers?: Record<string, string>
}

/**
 * Fetch a user-supplied URL with every hop validated.
 *
 * Redirects are followed by hand so each Location is re-checked; `fetch`'s own
 * 'follow' mode would validate only the first URL, which is the standard way
 * an SSRF filter is bypassed.
 */
export async function safeFetch(raw: string, opts: SafeFetchOptions = {}): Promise<Response> {
  const { timeoutMs = 6000, maxRedirects = 3, headers = {} } = opts

  let current = await assertFetchableUrl(raw)
  const deadline = Date.now() + timeoutMs

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new BlockedUrlError('انتهت مهلة جلب الرابط')

    const res = await fetch(current.toString(), {
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(remaining),
    })

    if (res.status < 300 || res.status > 399) return res

    const location = res.headers.get('location')
    if (!location) return res
    // Re-validate the redirect target exactly like the original URL.
    current = await assertFetchableUrl(new URL(location, current).toString())
  }

  throw new BlockedUrlError('عدد عمليات إعادة التوجيه كبير جداً')
}
