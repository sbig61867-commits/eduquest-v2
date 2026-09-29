// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MANIFEST_NAME, backupId, compress, decompress, decrypt, encrypt, groupBackups, kvClient, packFiles,
  planPrune, splitParts, unpackFiles,
} from '../../scripts/backup/lib.mjs'
import { runBackup } from '../../scripts/backup/backup.mjs'
import { listBackups, restoreToFiles } from '../../scripts/backup/restore.mjs'

// 2048-bit keys keep the suite fast; keygen.mjs makes 4096-bit ones.
const pair = () => generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})
const keys = pair()
const noWait = { attempts: 3, delayMs: 0, sleep: async () => {} }

/** In-memory Workers KV. `lag` = how many reads of a fresh key return null first. */
function fakeKv({ lag = 0, corrupt }: { lag?: number; corrupt?: (key: string) => boolean } = {}) {
  const store = new Map<string, Buffer>()
  const misses = new Map<string, number>()
  const writes: string[] = []
  return {
    store, writes,
    async put(key: string, bytes: Uint8Array) { store.set(key, Buffer.from(bytes)); writes.push(key); misses.set(key, lag) },
    async get(key: string) {
      const left = misses.get(key) ?? 0
      if (left > 0) { misses.set(key, left - 1); return null }
      const v = store.get(key)
      if (!v) return null
      if (corrupt?.(key)) { const c = Buffer.from(v); c[0] ^= 0xff; return c }
      return v
    },
    async list(prefix: string) { return [...store.keys()].filter(k => k.startsWith(prefix)) },
    async delete(key: string) { store.delete(key) },
  }
}

function dumpDir(data = 'COPY public.users (id, email) FROM stdin;\n1\ta@b.c\n\\.\n') {
  const dir = mkdtempSync(join(tmpdir(), 'eq-dump-'))
  writeFileSync(join(dir, 'roles.sql'), '-- roles\n')
  writeFileSync(join(dir, 'schema.sql'), 'CREATE TABLE public.users (id int, email text);\n'.repeat(50))
  writeFileSync(join(dir, 'data.sql'), data)
  return dir
}

describe('backup format', () => {
  it('packs and unpacks named files, including an empty one', () => {
    const files = [
      { name: 'roles.sql', data: Buffer.alloc(0) },
      { name: 'data.sql', data: Buffer.from('نص عربي\nCOPY …') },
    ]
    expect(unpackFiles(packFiles(files)).map(f => [f.name, f.data.toString()])).toEqual(files.map(f => [f.name, f.data.toString()]))
  })

  it('compresses SQL text and restores it exactly', () => {
    const sql = Buffer.from('INSERT INTO public.grades VALUES (1, 95);\n'.repeat(5000))
    const small = compress(sql)
    expect(small.length).toBeLessThan(sql.length / 20)
    expect(decompress(small).equals(sql)).toBe(true)
  })

  it('encrypts so only the private key opens it, and rejects any altered byte', () => {
    const plain = Buffer.from('student emails and grades')
    const sealed = encrypt(plain, keys.publicKey)
    expect(sealed.includes(plain)).toBe(false)
    expect(decrypt(sealed, keys.privateKey).equals(plain)).toBe(true)
    expect(() => decrypt(sealed, pair().privateKey)).toThrow()
    const tampered = Buffer.from(sealed)
    tampered[tampered.length - 1] ^= 1
    expect(() => decrypt(tampered, keys.privateKey)).toThrow()
  })

  it('opens a backup with a passphrase-protected private key', () => {
    const locked = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'pw' },
    })
    const sealed = encrypt(Buffer.from('x'), locked.publicKey)
    expect(decrypt(sealed, locked.privateKey, 'pw').toString()).toBe('x')
    expect(() => decrypt(sealed, locked.privateKey, 'wrong')).toThrow()
  })

  it('splits into KV-sized parts and makes sortable ids', () => {
    expect(splitParts(Buffer.alloc(45), 20).map(p => p.length)).toEqual([20, 20, 5])
    expect(backupId(new Date('2026-09-28T19:30:05.123Z'))).toBe('2026-09-28T19-30-05Z')
    expect(backupId(new Date('2026-10-01T00:00:00Z')) > backupId(new Date('2026-09-15T00:00:00Z'))).toBe(true)
  })
})

describe('keeping copies', () => {
  const ids = ['2026-01-01T00-00-00Z', '2026-01-15T00-00-00Z', '2026-02-01T00-00-00Z', '2026-02-15T00-00-00Z']
  const names = ids.flatMap(id => [`backup/${id}/part-000`, `backup/${id}/${MANIFEST_NAME}`])

  it('keeps the newest complete copies and drops the rest', () => {
    const doomed = planPrune(groupBackups(names), 2, ids[3]).map(g => g.id)
    expect(doomed).toEqual([ids[1], ids[0]])
  })

  it('removes unfinished uploads but never the copy just written', () => {
    const unfinished = ['backup/2026-01-20T00-00-00Z/part-000', 'backup/2026-03-01T00-00-00Z/part-000']
    const doomed = planPrune(groupBackups([...names, ...unfinished]), 8, '2026-03-01T00-00-00Z').map(g => g.id)
    expect(doomed).toEqual(['2026-01-20T00-00-00Z'])
  })
})

describe('backup to KV and restore', () => {
  it('uploads parts before the manifest, reads it back, and restores identical files', async () => {
    const kv = fakeKv({ lag: 1 })
    const dir = dumpDir()
    const { manifest } = await runBackup({ dir, reason: 'test', publicKeyPem: keys.publicKey, kv, log: () => {}, retry: noWait })
    expect(kv.writes.at(-1)).toBe(`backup/${manifest.id}/${MANIFEST_NAME}`)
    expect(manifest.files.map((f: { name: string }) => f.name)).toEqual(['roles.sql', 'schema.sql', 'data.sql'])

    const out = mkdtempSync(join(tmpdir(), 'eq-restore-'))
    const restored = await restoreToFiles({ kv, id: 'latest', privateKeyPem: keys.privateKey, outDir: out, retry: noWait })
    expect(restored.manifest.id).toBe(manifest.id)
    for (const name of ['roles.sql', 'schema.sql', 'data.sql']) {
      expect(readFileSync(join(out, name)).equals(readFileSync(join(dir, name)))).toBe(true)
    }
    expect((await listBackups(kv)).map(m => m.id)).toEqual([manifest.id])
  })

  it('prunes to the newest copies only after the new one verifies', async () => {
    const kv = fakeKv()
    for (let d = 1; d <= 9; d++) {
      const id = `2026-01-0${d}T00-00-00Z`
      await kv.put(`backup/${id}/part-000`, Buffer.from('old'))
      await kv.put(`backup/${id}/${MANIFEST_NAME}`, Buffer.from('{}'))
    }
    const { removed } = await runBackup({ dir: dumpDir(), publicKeyPem: keys.publicKey, kv, keep: 8, log: () => {}, retry: noWait })
    expect(removed).toEqual(['2026-01-02T00-00-00Z', '2026-01-01T00-00-00Z'])
    expect(groupBackups([...kv.store.keys()]).filter(g => g.complete)).toHaveLength(8)
  })

  it('leaves older copies alone when the new one does not read back intact', async () => {
    const kv = fakeKv({ corrupt: key => key.endsWith('/part-000') && !key.startsWith('backup/2026-01') })
    await kv.put('backup/2026-01-01T00-00-00Z/part-000', Buffer.from('old'))
    await kv.put(`backup/2026-01-01T00-00-00Z/${MANIFEST_NAME}`, Buffer.from('{}'))
    await expect(runBackup({ dir: dumpDir(), publicKeyPem: keys.publicKey, kv, keep: 0, log: () => {}, retry: noWait }))
      .rejects.toThrow(/corrupted/)
    expect(kv.store.has(`backup/2026-01-01T00-00-00Z/${MANIFEST_NAME}`)).toBe(true)
  })

  it('refuses an empty data dump', async () => {
    await expect(runBackup({ dir: dumpDir(''), publicKeyPem: keys.publicKey, kv: fakeKv(), log: () => {} }))
      .rejects.toThrow(/Empty dump/)
  })

  it('refuses to decrypt with a different key', async () => {
    const kv = fakeKv()
    await runBackup({ dir: dumpDir(), publicKeyPem: keys.publicKey, kv, log: () => {}, retry: noWait })
    await expect(restoreToFiles({ kv, privateKeyPem: pair().privateKey, outDir: mkdtempSync(join(tmpdir(), 'eq-x-')), retry: noWait }))
      .rejects.toThrow()
  })
})

describe('Workers KV client', () => {
  it('encodes keys, follows list cursors and treats a missing key as deleted', async () => {
    const calls: { url: string; method: string }[] = []
    const fakeFetch = async (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: init.method ?? 'GET' })
      if (url.includes('/keys?') && !url.includes('cursor=')) {
        return Response.json({ result: [{ name: 'backup/a/part-000' }], result_info: { cursor: 'c2' } })
      }
      if (url.includes('/keys?')) return Response.json({ result: [{ name: 'backup/a/manifest.json' }], result_info: { cursor: '' } })
      if (init.method === 'DELETE') return new Response('', { status: 404 })
      return new Response('ok')
    }
    const kv = kvClient({ accountId: 'acc', namespaceId: 'ns', token: 't', fetchImpl: fakeFetch as unknown as typeof fetch })
    await kv.put('backup/a/part-000', Buffer.from('x'))
    expect(calls[0].url).toBe('https://api.cloudflare.com/client/v4/accounts/acc/storage/kv/namespaces/ns/values/backup%2Fa%2Fpart-000')
    expect(await kv.list('backup/')).toEqual(['backup/a/part-000', 'backup/a/manifest.json'])
    await expect(kv.delete('backup/gone')).resolves.toBeUndefined()
  })
})
