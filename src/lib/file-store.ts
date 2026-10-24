import { run, maybeOne } from '@/lib/db/sql'
import { storageStatus, type StorageStatus } from '@/lib/storage-quota'

// ── Files on Cloudflare R2 (step 11) ─────────────────────────────────────────
//
// One bucket, bound to the Worker as FILES (wrangler.jsonc → r2_buckets); no R2
// API keys anywhere. Key layout — the prefix is what the routes check before
// they accept a path (src/lib/exam-files.ts):
//   <tenant>/tasks/<teacher>/<uuid>.<ext>                  teacher attachment
//   <tenant>/answers/<exam>/<student>/<question>.<ext>     student answer photo
//   <tenant>/lessons/<teacher>/<uuid>.<ext>                lesson image block
//   public/announcements/<tenant>/<uuid>.<ext>             announcement image
//
// Private files are personal: they are served only through
// GET /api/files/<key>?exp=…&sig=… — an HMAC-SHA256 link (FILES_SIGNING_SECRET)
// that a page hands out after its own access check and that dies after
// SIGNED_URL_SECONDS. A stored key alone opens nothing. Announcement images are
// served under public/ to any signed-in user, as the public bucket did.
//
// Every stored object has a row in public.stored_files (neon/migrations/0011),
// written in the same unit as the object, so the institution's storage quota
// is a sum on its own rows.
//
// `next dev` on Node has no bindings: objects go to .local-files/ (git-ignored)
// so the flows can be exercised locally; nothing there is ever deployed.

/** Long enough to read a task or grade it; short enough that a copied link dies. */
export const SIGNED_URL_SECONDS = 60 * 60
export const PUBLIC_PREFIX = 'public/'

type StoredObject = { body: ReadableStream | Uint8Array; contentType: string; size: number }
interface Store {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>
  get(key: string): Promise<StoredObject | null>
  remove(keys: string[]): Promise<void>
}

type R2Bucket = {
  put(key: string, value: Uint8Array, opts: { httpMetadata: { contentType: string } }): Promise<unknown>
  get(key: string): Promise<{ body: ReadableStream; size: number; httpMetadata?: { contentType?: string } } | null>
  delete(keys: string | string[]): Promise<void>
}

const onWorkers = typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers'

async function r2(): Promise<Store> {
  const { getCloudflareContext } = await import('@opennextjs/cloudflare')
  const { env } = await getCloudflareContext({ async: true })
  const bucket = (env as unknown as { FILES?: R2Bucket }).FILES
  if (!bucket) throw new Error('file store: the FILES bucket is not bound')
  return {
    put: async (key, bytes, contentType) => { await bucket.put(key, bytes, { httpMetadata: { contentType } }) },
    get: async key => {
      const o = await bucket.get(key)
      return o ? { body: o.body, size: o.size, contentType: o.httpMetadata?.contentType ?? 'application/octet-stream' } : null
    },
    remove: async keys => { if (keys.length) await bucket.delete(keys) },
  }
}

async function localDir(): Promise<Store> {
  const { mkdir, readFile, writeFile, rm } = await import('node:fs/promises')
  const { join, dirname } = await import('node:path')
  const root = join(process.cwd(), '.local-files')
  const file = (key: string) => join(root, ...key.split('/'))
  return {
    put: async (key, bytes, contentType) => {
      await mkdir(dirname(file(key)), { recursive: true })
      await writeFile(file(key), bytes)
      await writeFile(`${file(key)}.type`, contentType)
    },
    get: async key => {
      try {
        const bytes = new Uint8Array(await readFile(file(key)))
        const contentType = await readFile(`${file(key)}.type`, 'utf8').catch(() => 'application/octet-stream')
        return { body: bytes, size: bytes.length, contentType }
      } catch { return null }
    },
    remove: async keys => { await Promise.all(keys.flatMap(k => [rm(file(k), { force: true }), rm(`${file(k)}.type`, { force: true })])) },
  }
}

const store = (): Promise<Store> => (onWorkers ? r2() : localDir())

/** The owning institution of a key (its first segment, or the third under public/announcements/). */
export function tenantOfKey(key: string): string | null {
  const parts = key.split('/')
  const id = parts[0] === 'public' ? parts[2] : parts[0]
  return id && /^[0-9a-f-]{36}$/i.test(id) ? id : null
}

/** Stores one object and records it for the quota, as app_service of its institution. */
export async function putFile(tenantId: string, key: string, bytes: Uint8Array, contentType: string): Promise<void> {
  if (tenantOfKey(key) !== tenantId) throw new Error('file store: key outside the institution')
  await (await store()).put(key, bytes, contentType)
  await run({ as: 'service', tenantId }, sql => [
    sql`insert into public.stored_files (key, tenant_id, bytes, content_type)
        values (${key}, ${tenantId}, ${bytes.length}, ${contentType})
        on conflict (key) do update set bytes = excluded.bytes, content_type = excluded.content_type, created_at = now()`,
  ])
}

/** Removes objects of one institution and their quota rows (missing ones are ignored). */
export async function removeFiles(tenantId: string, keys: string[]): Promise<void> {
  const own = keys.filter(k => tenantOfKey(k) === tenantId)
  if (!own.length) return
  await (await store()).remove(own)
  await run({ as: 'service', tenantId }, sql => [
    sql`delete from public.stored_files where tenant_id = ${tenantId} and key in (select jsonb_array_elements_text(${sql.json(own)}))`,
  ])
}

/** The object, for GET /api/files (the route has already checked the viewer). */
export async function readStoredFile(key: string): Promise<StoredObject | null> {
  return (await store()).get(key)
}

/** May `incomingBytes` more be stored by this institution (owner's plan limit)? Fails open on a read error. */
export async function checkStorageQuotaAs(tenantId: string, incomingBytes: number): Promise<StorageStatus> {
  try {
    const [rows] = await run({ as: 'service', tenantId }, sql => [
      sql`select t.storage_limit_mb, public.tenant_storage_bytes(t.id) as used from public.tenants t where t.id = ${tenantId}`,
    ])
    const r = maybeOne<{ storage_limit_mb: number | null; used: number | string }>(rows)
    if (!r || r.storage_limit_mb == null) return { limitBytes: null, usedBytes: null, allowed: true }
    return storageStatus(r.storage_limit_mb, Number(r.used), incomingBytes)
  } catch (e) {
    console.error('[storage-quota] read failed, allowing:', e instanceof Error ? e.message : e)
    return { limitBytes: null, usedBytes: null, allowed: true }
  }
}

// ── Signed links ─────────────────────────────────────────────────────────────

async function signingKey(): Promise<CryptoKey> {
  const secret = process.env.FILES_SIGNING_SECRET
  if (!secret || secret.length < 32) throw new Error('file store: FILES_SIGNING_SECRET is missing or shorter than 32 characters')
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

const b64url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))

const encodeKey = (key: string) => key.split('/').map(encodeURIComponent).join('/')

/** A link to one private object, valid for `seconds`. The caller must already have decided the viewer may see it. */
export async function signedFileUrl(key: string, seconds = SIGNED_URL_SECONDS, now = Date.now()): Promise<string> {
  const exp = Math.floor(now / 1000) + seconds
  const sig = await crypto.subtle.sign('HMAC', await signingKey(), new TextEncoder().encode(`${key}\n${exp}`))
  return `/api/files/${encodeKey(key)}?exp=${exp}&sig=${b64url(sig)}`
}

/** Signs many keys, in order; an empty or non-string key is dropped. */
export async function signedFileUrls(keys: unknown[]): Promise<string[]> {
  const clean = keys.filter((k): k is string => typeof k === 'string' && k.length > 0)
  return Promise.all(clean.map(k => signedFileUrl(k)))
}

/** Is `sig` a valid, unexpired signature of `key`? Constant-time (HMAC verify). */
export async function verifyFileSignature(key: string, exp: string | null, sig: string | null, now = Date.now()): Promise<boolean> {
  if (!exp || !sig || !/^\d{1,12}$/.test(exp) || Number(exp) * 1000 < now) return false
  try {
    return await crypto.subtle.verify('HMAC', await signingKey(), fromB64url(sig), new TextEncoder().encode(`${key}\n${exp}`))
  } catch { return false }
}

/** The link of a public object (announcement images). */
export const publicFileUrl = (key: string) => `/api/files/${encodeKey(key)}`
