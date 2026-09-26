import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  deleteEvidence, evidenceBackend, evidenceViewUrl, getEvidence, isEvidenceStoreConfigured,
  listEvidenceKeys, putEvidence,
} from '@/lib/evidence-store'

const S3_ENV = {
  EVIDENCE_S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com/',
  EVIDENCE_S3_BUCKET: 'eduquest-evidence',
  EVIDENCE_S3_ACCESS_KEY_ID: 'AKIDEXAMPLE',
  EVIDENCE_S3_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
}
const KV_ENV = {
  EVIDENCE_KV_ACCOUNT_ID: 'acct123',
  EVIDENCE_KV_NAMESPACE_ID: 'ns456',
  EVIDENCE_KV_API_TOKEN: 'test-token',
}
const NONE = Object.fromEntries([...Object.keys(S3_ENV), ...Object.keys(KV_ENV)].map(k => [k, '']))

type Call = { url: string; method: string; headers: Headers }
let calls: Call[]

function stubFetch(respond: (url: string, method: string) => Response) {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init)
    calls.push({ url: req.url, method: req.method, headers: req.headers })
    return respond(req.url, req.method)
  }))
}

function useEnv(env: Record<string, string>) {
  for (const [k, v] of Object.entries({ ...NONE, ...env })) vi.stubEnv(k, v)
}

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('evidence store: nothing configured', () => {
  it('is off and never touches the network', async () => {
    useEnv({})
    stubFetch(() => new Response(''))
    expect(evidenceBackend()).toBeNull()
    expect(isEvidenceStoreConfigured()).toBe(false)
    expect(await putEvidence('evidence/a', new Uint8Array([1]), 'webp', Date.now() + 1e6)).toBe(false)
    expect(await getEvidence('evidence/a')).toBeNull()
    expect(await listEvidenceKeys('evidence/')).toEqual([])
    expect(await evidenceViewUrl('evidence/a', 60)).toBeNull()
    expect(calls).toHaveLength(0)
  })
})

describe('evidence store: Cloudflare Workers KV', () => {
  beforeEach(() => useEnv(KV_ENV))

  it('wins over S3 when both are configured', () => {
    useEnv({ ...S3_ENV, ...KV_ENV })
    expect(evidenceBackend()).toBe('kv')
  })

  it('writes with an absolute expiry so Cloudflare deletes it by itself', async () => {
    stubFetch(() => new Response('{"success":true}'))
    const expires = Date.now() + 30 * 3600 * 1000
    expect(await putEvidence('evidence/e/s/1-tab_switch.webp', new Uint8Array([1, 2]), 'webp', expires)).toBe(true)
    const url = new URL(calls[0].url)
    expect(calls[0].method).toBe('PUT')
    expect(url.pathname).toBe('/client/v4/accounts/acct123/storage/kv/namespaces/ns456/values/evidence%2Fe%2Fs%2F1-tab_switch.webp')
    expect(url.searchParams.get('expiration')).toBe(String(Math.floor(expires / 1000)))
    expect(calls[0].headers.get('authorization')).toBe('Bearer test-token')
  })

  it('never asks KV for less than the 60 second minimum expiry', async () => {
    stubFetch(() => new Response('{}'))
    await putEvidence('evidence/k', new Uint8Array([1]), 'webp', Date.now() + 5_000)
    const exp = Number(new URL(calls[0].url).searchParams.get('expiration'))
    expect(exp).toBeGreaterThanOrEqual(Math.floor(Date.now() / 1000) + 59)
  })

  it('reads bytes back and treats a missing value as gone', async () => {
    stubFetch(url => (url.includes('missing') ? new Response('', { status: 404 }) : new Response(new Uint8Array([7, 8]))))
    expect(Array.from((await getEvidence('evidence/here'))!)).toEqual([7, 8])
    expect(await getEvidence('evidence/missing')).toBeNull()
  })

  it('never lists KV (capped on the free plan) and serves images through the app', async () => {
    stubFetch(() => new Response(''))
    expect(await listEvidenceKeys('evidence/')).toEqual([])
    expect(await evidenceViewUrl('evidence/e/s/1-tab_switch.webp', 600)).toBe('/api/proctor/evidence/image?key=evidence%2Fe%2Fs%2F1-tab_switch.webp')
    expect(await evidenceViewUrl('evidence/x', 0)).toBeNull()
    expect(calls).toHaveLength(0)
  })
})

describe('evidence store: S3-compatible (R2)', () => {
  beforeEach(() => useEnv(S3_ENV))

  it('uploads with a SigV4 signature to the private bucket', async () => {
    stubFetch(() => new Response('', { status: 200 }))
    expect(evidenceBackend()).toBe('s3')
    expect(await putEvidence('evidence/e/s/1-tab_switch.webp', new Uint8Array([1, 2, 3]), 'webp', Date.now() + 1e6)).toBe(true)
    expect(calls[0].method).toBe('PUT')
    expect(calls[0].url).toBe('https://acct.r2.cloudflarestorage.com/eduquest-evidence/evidence/e/s/1-tab_switch.webp')
    expect(calls[0].headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/auto\/s3\/aws4_request/)
    expect(calls[0].headers.get('content-type')).toBe('image/webp')
  })

  it('follows ListObjectsV2 pagination', async () => {
    const page1 = '<ListBucketResult><Contents><Key>evidence/a</Key></Contents><IsTruncated>true</IsTruncated><NextContinuationToken>t&amp;2</NextContinuationToken></ListBucketResult>'
    const page2 = '<ListBucketResult><Contents><Key>evidence/b</Key></Contents><IsTruncated>false</IsTruncated></ListBucketResult>'
    stubFetch(url => new Response(new URL(url).searchParams.get('continuation-token') ? page2 : page1))
    expect(await listEvidenceKeys('evidence/')).toEqual(['evidence/a', 'evidence/b'])
    expect(new URL(calls[1].url).searchParams.get('continuation-token')).toBe('t&2')
  })

  it('deletes each key and counts a missing object as gone', async () => {
    stubFetch(url => (url.endsWith('/b') ? new Response('', { status: 404 }) : new Response(null, { status: 204 })))
    expect(await deleteEvidence(['evidence/a', 'evidence/b'])).toBe(2)
    expect(calls.every(c => c.method === 'DELETE')).toBe(true)
  })

  it('signs a short-lived GET link without contacting the bucket', async () => {
    stubFetch(() => new Response(''))
    const url = new URL((await evidenceViewUrl('evidence/e/s/1-tab_switch.webp', 600))!)
    expect(url.searchParams.get('X-Amz-Expires')).toBe('600')
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)
    expect(calls).toHaveLength(0)
  })
})
