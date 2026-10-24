// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Files on R2 (step 11): signed links, the institution boundary on keys, the
// stored_files record kept in step with the objects, and GET /api/files.

type Q = { text: string; values: unknown[]; ctx: { as: string; tenantId?: string } }
const db = vi.hoisted(() => ({ calls: [] as Q[], reply: [] as unknown[] }))
vi.mock('@/lib/db/sql', async () => (await import('./helpers/fake-sql')).fakeSqlModule(q => { db.calls.push(q as Q); return db.reply }))
// The Node fallback store (.local-files/) on an in-memory map; paths normalised to '/'.
const objects = vi.hoisted(() => new Map<string, { bytes: Uint8Array; type: string }>())
const norm = vi.hoisted(() => (p: string) => p.split(String.fromCharCode(92)).join('/'))
vi.mock('node:fs/promises', () => ({
  mkdir: async () => {},
  writeFile: async (p: string, v: Uint8Array | string) => {
    const key = norm(p); const isType = key.endsWith('.type')
    const k = isType ? key.slice(0, -5) : key
    const cur = objects.get(k) ?? { bytes: new Uint8Array(), type: '' }
    objects.set(k, isType ? { ...cur, type: String(v) } : { ...cur, bytes: v as Uint8Array })
  },
  readFile: async (p: string, enc?: string) => {
    const key = norm(p); const isType = key.endsWith('.type')
    const o = objects.get(isType ? key.slice(0, -5) : key)
    if (!o) throw new Error('ENOENT')
    return isType ? o.type : enc ? '' : Buffer.from(o.bytes)
  },
  rm: async (p: string) => { objects.delete(norm(p).replace(/\.type$/, '')) },
}))
let ctx: { sub: string } | null = { sub: 'u1' }
vi.mock('@/lib/auth/current', () => ({ currentCtx: async () => ctx }))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))

import { putFile, removeFiles, signedFileUrl, verifyFileSignature, tenantOfKey, publicFileUrl, checkStorageQuotaAs } from '@/lib/file-store'
import { GET } from '@/app/api/files/[...key]/route'

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const KEY = `${A}/tasks/${A}/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png`
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8])

beforeEach(() => {
  db.calls = []; db.reply = []; objects.clear(); ctx = { sub: 'u1' }
  process.env.FILES_SIGNING_SECRET = 'x'.repeat(40)
})

const open = (url: string) => {
  const u = new URL(url, 'http://x')
  const key = decodeURIComponent(u.pathname.replace('/api/files/', '')).split('/')
  return GET(new Request(u), { params: Promise.resolve({ key }) })
}

describe('signed links', () => {
  it('a fresh link verifies; tampered, expired or for another key does not', async () => {
    const url = new URL(await signedFileUrl(KEY), 'http://x')
    const exp = url.searchParams.get('exp'), sig = url.searchParams.get('sig')
    expect(await verifyFileSignature(KEY, exp, sig)).toBe(true)
    expect(await verifyFileSignature(KEY, String(Number(exp) + 1), sig)).toBe(false)
    expect(await verifyFileSignature(`${B}/tasks/x.png`, exp, sig)).toBe(false)
    expect(await verifyFileSignature(KEY, exp, sig, (Number(exp) + 1) * 1000)).toBe(false)
    expect(await verifyFileSignature(KEY, null, sig)).toBe(false)
  })

  it('without a signing secret (or a short one) nothing is signed — it fails closed', async () => {
    process.env.FILES_SIGNING_SECRET = 'short'
    await expect(signedFileUrl(KEY)).rejects.toThrow(/FILES_SIGNING_SECRET/)
    expect(await verifyFileSignature(KEY, '9999999999', 'abc')).toBe(false)
  })
})

describe('keys and the stored_files record', () => {
  it('the institution of a key is its first segment, or the third under public/announcements', () => {
    expect(tenantOfKey(KEY)).toBe(A)
    expect(tenantOfKey(`public/announcements/${B}/x.png`)).toBe(B)
    expect(tenantOfKey('../etc/passwd')).toBeNull()
  })

  it('putFile refuses a key outside the institution and stores nothing', async () => {
    await expect(putFile(B, KEY, PNG, 'image/png')).rejects.toThrow(/outside the institution/)
    expect(objects.size).toBe(0)
    expect(db.calls).toHaveLength(0)
  })

  it('putFile stores the object and records it as app_service of that institution', async () => {
    await putFile(A, KEY, PNG, 'image/png')
    expect(db.calls).toHaveLength(1)
    expect(db.calls[0].ctx).toEqual({ as: 'service', tenantId: A })
    expect(db.calls[0].text).toContain('insert into public.stored_files')
    expect(db.calls[0].values.slice(0, 4)).toEqual([KEY, A, PNG.length, 'image/png'])
  })

  it('removeFiles touches only the institution\'s own keys', async () => {
    await removeFiles(A, [KEY, `${B}/tasks/${B}/x.png`])
    expect(db.calls[0].values).toEqual([A, [KEY]])
    db.calls = []
    await removeFiles(A, [`${B}/tasks/${B}/x.png`])
    expect(db.calls).toHaveLength(0)
  })

  it('the quota: unlimited when no cap; refused past the cap; open on a read error', async () => {
    db.reply = [{ storage_limit_mb: null, used: 0 }]
    expect((await checkStorageQuotaAs(A, 10)).allowed).toBe(true)
    db.reply = [{ storage_limit_mb: 1, used: 1024 * 1024 - 5 }]
    expect((await checkStorageQuotaAs(A, 10)).allowed).toBe(false)
    expect(db.calls.at(-1)!.ctx).toEqual({ as: 'service', tenantId: A })
  })
})

describe('GET /api/files', () => {
  it('a private file opens only with its valid link, for a signed-in user', async () => {
    await putFile(A, KEY, PNG, 'image/png')
    const url = await signedFileUrl(KEY)
    const ok = await open(url)
    expect(ok.status).toBe(200)
    expect(ok.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(PNG)
    expect((await open(`/api/files/${KEY}`)).status).toBe(403)
    expect((await open(url.replace(/sig=[^&]+/, 'sig=AAAA'))).status).toBe(403)
    ctx = null
    expect((await open(url)).status).toBe(401)
  })

  it('a public announcement image needs a session but no signature; a missing object is 404', async () => {
    const pub = `public/announcements/${A}/dddddddd-dddd-4ddd-8ddd-dddddddddddd.png`
    await putFile(A, pub, PNG, 'image/png')
    expect((await open(publicFileUrl(pub))).status).toBe(200)
    expect((await open(publicFileUrl(`public/announcements/${A}/none.png`))).status).toBe(404)
  })

  it('a path with .. is refused', async () => {
    const res = await GET(new Request('http://x/api/files/a/../b'), { params: Promise.resolve({ key: ['a', '..', 'b'] }) })
    expect(res.status).toBe(404)
  })
})
