/**
 * Security — the SSRF guard on user-supplied URLs (`src/lib/safe-fetch.ts`).
 *
 * One route makes the server fetch a URL the caller typed and hands the
 * response body back: the announcement link-preview. Before this guard it was
 * protected only by requiring a session, which bounds WHO can trigger it and
 * nothing else — every signed-in user, students included, could read back
 * whatever the serverless function could reach.
 *
 * The three bypasses this suite exists to prevent, in the order attackers try
 * them:
 *  S1  Ask for the internal address directly (127.0.0.1, 169.254.169.254, 10.x).
 *  S2  Hide it behind a public hostname whose DNS record points inward, or
 *      behind URL credentials / an alternate IP notation.
 *  S3  Pass a genuinely public URL that redirects inward once the first
 *      check has already passed — the classic filter bypass.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isPrivateAddress, assertFetchableUrl, safeFetch, BlockedUrlError } from '@/lib/safe-fetch'

// DNS is mocked so the suite is hermetic and never touches the network.
const lookupMock = vi.fn()
vi.mock('node:dns/promises', () => {
  const mod = { lookup: (...args: unknown[]) => lookupMock(...args) }
  return { ...mod, default: mod }
})

/** Resolve every hostname to a public address unless told otherwise. */
function dnsResolvesTo(address: string) {
  lookupMock.mockResolvedValue([{ address, family: address.includes(':') ? 6 : 4 }])
}

beforeEach(() => {
  lookupMock.mockReset()
  dnsResolvesTo('93.184.216.34') // example.com, public
})
afterEach(() => { vi.restoreAllMocks() })

describe('S1 — private address ranges are rejected outright', () => {
  const PRIVATE = [
    ['loopback',            '127.0.0.1'],
    ['loopback, other host','127.0.0.53'],
    ['cloud metadata',      '169.254.169.254'],
    ['link-local',          '169.254.1.1'],
    ['private 10/8',        '10.0.0.1'],
    ['private 172.16/12',   '172.16.0.1'],
    ['private 172.31/12',   '172.31.255.255'],
    ['private 192.168/16',  '192.168.1.1'],
    ['this network',        '0.0.0.0'],
    ['carrier-grade NAT',   '100.64.0.1'],
    ['benchmarking',        '198.18.0.1'],
    ['multicast',           '224.0.0.1'],
    ['broadcast',           '255.255.255.255'],
    ['IPv6 loopback',       '::1'],
    ['IPv6 unspecified',    '::'],
    ['IPv6 link-local',     'fe80::1'],
    ['IPv6 unique local',   'fd00::1'],
    ['IPv6 multicast',      'ff02::1'],
    ['IPv4-mapped private', '::ffff:169.254.169.254'],
  ] as const

  it.each(PRIVATE)('treats %s (%s) as private', (_label, ip) => {
    expect(isPrivateAddress(ip)).toBe(true)
  })

  const PUBLIC = ['93.184.216.34', '8.8.8.8', '1.1.1.1', '172.32.0.1', '192.169.0.1', '2606:4700::1111']
  it.each(PUBLIC)('treats %s as public', ip => {
    expect(isPrivateAddress(ip)).toBe(false)
  })

  it('treats anything that is not an IP as unsafe', () => {
    for (const junk of ['', 'not-an-ip', '999.999.999.999', '10.0.0', '0x7f000001']) {
      expect(isPrivateAddress(junk)).toBe(true)
    }
  })

  it('rejects a literal private IP in the URL without any DNS lookup', async () => {
    for (const url of ['http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]:5432/']) {
      await expect(assertFetchableUrl(url)).rejects.toBeInstanceOf(BlockedUrlError)
    }
    expect(lookupMock).not.toHaveBeenCalled()
  })

  it('rejects localhost and internal TLDs by name', async () => {
    for (const url of ['http://localhost/', 'http://db.localhost/', 'http://api.internal/', 'http://printer.local/']) {
      await expect(assertFetchableUrl(url)).rejects.toBeInstanceOf(BlockedUrlError)
    }
  })
})

describe('S2 — a public hostname cannot smuggle a private target', () => {
  it('rejects a hostname whose DNS record resolves inward', async () => {
    dnsResolvesTo('169.254.169.254')
    await expect(assertFetchableUrl('https://totally-normal.example/')).rejects.toBeInstanceOf(BlockedUrlError)
  })

  it('rejects when only ONE of several records is private', async () => {
    // A split record set is enough — the connection may pick either address.
    lookupMock.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ])
    await expect(assertFetchableUrl('https://mixed.example/')).rejects.toBeInstanceOf(BlockedUrlError)
  })

  it('rejects a hostname that does not resolve at all', async () => {
    lookupMock.mockRejectedValue(new Error('ENOTFOUND'))
    await expect(assertFetchableUrl('https://nope.example/')).rejects.toBeInstanceOf(BlockedUrlError)
    lookupMock.mockResolvedValue([])
    await expect(assertFetchableUrl('https://empty.example/')).rejects.toBeInstanceOf(BlockedUrlError)
  })

  it('rejects credentials embedded in the URL', async () => {
    // http://evil.example@127.0.0.1/ parses with host 127.0.0.1 in browsers
    // and is a standard way to confuse a naive string check.
    await expect(assertFetchableUrl('http://user:pass@example.com/')).rejects.toBeInstanceOf(BlockedUrlError)
  })

  it('rejects non-http schemes', async () => {
    for (const url of ['file:///etc/passwd', 'gopher://127.0.0.1:70/', 'ftp://example.com/', 'data:text/html,x']) {
      await expect(assertFetchableUrl(url)).rejects.toBeInstanceOf(BlockedUrlError)
    }
  })

  it('rejects a malformed URL rather than passing it to fetch', async () => {
    await expect(assertFetchableUrl('not a url')).rejects.toBeInstanceOf(BlockedUrlError)
  })

  it('accepts an ordinary public https URL', async () => {
    const url = await assertFetchableUrl('https://example.com/article?x=1')
    expect(url.hostname).toBe('example.com')
  })
})

describe('S3 — redirects are re-validated at every hop', () => {
  function mockFetchSequence(responses: Array<{ status: number; location?: string }>) {
    const calls: string[] = []
    const fetchMock = vi.fn(async (input: string) => {
      calls.push(String(input))
      const r = responses.shift() ?? { status: 200 }
      return new Response('<title>ok</title>', {
        status: r.status,
        headers: r.location ? { location: r.location } : {},
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    return calls
  }

  it('never follows a redirect into a private address', async () => {
    // The classic bypass: hop 1 is genuinely public and passes the first
    // check, then 302s to the metadata endpoint.
    const calls = mockFetchSequence([{ status: 302, location: 'http://169.254.169.254/latest/meta-data/' }])
    await expect(safeFetch('https://example.com/')).rejects.toBeInstanceOf(BlockedUrlError)
    // The inward URL must never have been requested.
    expect(calls).toEqual(['https://example.com/'])
  })

  it('never follows a redirect to loopback', async () => {
    mockFetchSequence([{ status: 301, location: 'http://127.0.0.1:8080/admin' }])
    await expect(safeFetch('https://example.com/')).rejects.toBeInstanceOf(BlockedUrlError)
  })

  it('re-checks DNS on the redirect target, not just the first URL', async () => {
    mockFetchSequence([{ status: 302, location: 'https://second.example/' }])
    lookupMock.mockReset()
    lookupMock
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]) // first hop: public
      .mockResolvedValueOnce([{ address: '10.1.2.3', family: 4 }])      // second hop: private
    await expect(safeFetch('https://first.example/')).rejects.toBeInstanceOf(BlockedUrlError)
    expect(lookupMock).toHaveBeenCalledTimes(2)
  })

  it('follows a public redirect chain and returns the final response', async () => {
    const calls = mockFetchSequence([
      { status: 302, location: 'https://b.example/' },
      { status: 200 },
    ])
    const res = await safeFetch('https://a.example/')
    expect(res.status).toBe(200)
    expect(calls).toEqual(['https://a.example/', 'https://b.example/'])
  })

  it('stops after the redirect budget instead of looping forever', async () => {
    // A server that redirects to itself must not spin the function.
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response('', { status: 302, headers: { location: 'https://loop.example/' } }),
    ))
    await expect(safeFetch('https://loop.example/', { maxRedirects: 2 })).rejects.toBeInstanceOf(BlockedUrlError)
  })

  it('never lets fetch follow redirects on its own', async () => {
    const seen: RequestInit[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      seen.push(init)
      return new Response('<title>ok</title>', { status: 200 })
    }))
    await safeFetch('https://example.com/')
    expect(seen[0]).toMatchObject({ redirect: 'manual' })
  })
})
