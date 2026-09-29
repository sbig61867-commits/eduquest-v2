/**
 * Security — the SSRF guard on the announcement link preview
 * (`src/app/api/announcements/preview-url/route.ts`), the one route that makes
 * the server fetch a URL the caller typed.
 *
 * The three bypasses this suite exists to prevent, in the order attackers try
 * them:
 *  S1  Ask for the internal address directly (127.0.0.1, 169.254.169.254, 10.x).
 *  S2  Hide it behind a public hostname whose DNS record points inward, or an
 *      alternate IP notation.
 *  S3  Pass a genuinely public URL that redirects inward once the first check
 *      has passed — the route never follows redirects (`redirect: 'manual'`).
 * Plus: who may call it at all (manage_announcements only, never a student).
 *
 * Adapted 2026-09-29 from the claude/marhaba branch, which tested a separate
 * safe-fetch module; main guards inside the route, so this drives the route.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// DNS is mocked so the suite is hermetic and never touches the network.
const lookupMock = vi.fn()
vi.mock('node:dns/promises', () => {
  const mod = { lookup: (...args: unknown[]) => lookupMock(...args) }
  return { ...mod, default: mod }
})

let role = 'university_admin'
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { role, tenant_id: 't1', permissions: {} } }) }) }),
    }),
  }),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => ({ allowed: true, resetAt: 0 }) }))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))

import { POST } from '@/app/api/announcements/preview-url/route'

const fetchMock = vi.fn()
const call = (url: string) =>
  POST(new Request('http://localhost/api/announcements/preview-url', { method: 'POST', body: JSON.stringify({ url }) }))
const codeOf = async (res: Response) => ((await res.json()) as { code?: string }).code

function dnsResolvesTo(address: string) {
  lookupMock.mockResolvedValue([{ address, family: address.includes(':') ? 6 : 4 }])
}

beforeEach(() => {
  role = 'university_admin'
  lookupMock.mockReset()
  dnsResolvesTo('93.184.216.34')
  fetchMock.mockReset().mockResolvedValue(new Response('<title>Hi</title>', { headers: { 'content-type': 'text/html' } }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('S0 — only announcement authors can make the server fetch', () => {
  it('refuses a student', async () => {
    role = 'student'
    const res = await call('https://example.com/')
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('S1 — internal addresses asked for directly', () => {
  it.each([
    'http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.5:22/',
    'http://172.16.0.1/', 'http://192.168.1.1/', 'http://100.64.0.1/', 'http://0.0.0.0/',
  ])('blocks %s without fetching', async url => {
    const res = await call(url)
    expect(res.status).toBe(400)
    expect(await codeOf(res)).toBe('internalAddressBlocked')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('blocks non-http schemes', async () => {
    for (const url of ['file:///etc/passwd', 'gopher://127.0.0.1/', 'ftp://example.com/']) {
      expect((await call(url)).status).toBe(400)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('S2 — internal addresses in disguise', () => {
  it('blocks a public hostname whose DNS points inward', async () => {
    dnsResolvesTo('10.1.2.3')
    const res = await call('https://innocent.example/')
    expect(await codeOf(res)).toBe('internalAddressBlocked')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('blocks when ANY of several DNS answers is internal', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }])
    expect(await codeOf(await call('https://mixed.example/'))).toBe('internalAddressBlocked')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('blocks decimal / hex IPv4 notations (the URL parser normalises them)', async () => {
    for (const url of ['http://2130706433/', 'http://0x7f.0.0.1/', 'http://0177.0.0.1/']) {
      expect(await codeOf(await call(url))).toBe('internalAddressBlocked')
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never fetches IPv6 loopback / IPv4-mapped literals', async () => {
    lookupMock.mockRejectedValue(new Error('ENOTFOUND'))
    for (const url of ['http://[::1]/', 'http://[::ffff:127.0.0.1]/']) {
      expect((await call(url)).status).toBe(400)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('S3 — a public URL that redirects inward', () => {
  it('does not follow redirects', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }))
    const res = await call('https://example.com/')
    expect(res.status).toBe(422)
    expect(await codeOf(res)).toBe('urlRedirects')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'manual' })
  })

  it('never echoes the network error (no internal-network oracle)', async () => {
    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:22'))
    const res = await call('https://example.com/')
    expect(JSON.stringify(await res.json())).not.toContain('10.0.0.5')
  })
})

describe('a legitimate public page still works', () => {
  it('returns its title', async () => {
    const res = await call('https://example.com/')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ title: 'Hi' })
  })
})
