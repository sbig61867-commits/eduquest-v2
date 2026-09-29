// Database backups: pack → compress → encrypt → split → Cloudflare Workers KV.
//
// Supabase's free plan keeps no backups at all. The workflow
// .github/workflows/db-backup.yml dumps the database twice a month (and on
// demand) with Supabase's own documented commands, then hands the three SQL
// files to backup.mjs, which uses the functions below. restore.mjs reverses it.
//
// Only Node built-ins: the workflow and a restore on the owner's PC need no
// npm install. Everything is in memory — the free database is capped at
// 500 MB, far below Node's buffer limit.
//
// Encryption: a fresh AES-256-GCM key per backup, wrapped with the owner's
// RSA public key (RSA-OAEP, SHA-256). The private key never leaves the
// owner's hands, so neither GitHub nor Cloudflare can read a backup.

import { constants as cryptoConstants, createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, privateDecrypt, publicEncrypt, randomBytes } from 'node:crypto'
import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants } from 'node:zlib'

export const DEFAULT_PREFIX = 'backup/'
/** Twice a month ⇒ 8 copies ≈ four months, plus any manual copies. */
export const DEFAULT_KEEP = 8
/** KV caps one value at 25 MiB; stay well under it. */
export const PART_BYTES = 20 * 1024 * 1024
/**
 * Free KV holds 1 GB for the WHOLE account, proctoring evidence included, so
 * all backups together stay under this budget — a full KV would also stop
 * evidence snapshots. One backup may use a third of it, so the budget plus
 * the copy being uploaded never passes ~800 MB.
 */
export const BUDGET_BYTES = 600 * 1024 * 1024
export const MAX_ENCRYPTED_BYTES = BUDGET_BYTES / 3
export const MANIFEST_NAME = 'manifest.json'

const MAGIC = Buffer.from('EQBK\x01', 'latin1')
const PACK_MAGIC = Buffer.from('EQPK\x01', 'latin1')

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

/** Sortable, key-safe id: 2026-09-28T19-30-05Z. */
export function backupId(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-')
}

// ── pack: several named files in one buffer ──────────────────────────────────

/** @param {{ name: string, data: Buffer }[]} files */
export function packFiles(files) {
  const chunks = [PACK_MAGIC]
  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, 'utf8')
    const head = Buffer.alloc(2 + nameBuf.length + 8)
    head.writeUInt16BE(nameBuf.length, 0)
    nameBuf.copy(head, 2)
    head.writeBigUInt64BE(BigInt(data.length), 2 + nameBuf.length)
    chunks.push(head, data)
  }
  return Buffer.concat(chunks)
}

/** @returns {{ name: string, data: Buffer }[]} */
export function unpackFiles(buf) {
  if (!buf.subarray(0, PACK_MAGIC.length).equals(PACK_MAGIC)) throw new Error('Not a packed backup')
  const files = []
  let at = PACK_MAGIC.length
  while (at < buf.length) {
    const nameLen = buf.readUInt16BE(at)
    const name = buf.subarray(at + 2, at + 2 + nameLen).toString('utf8')
    const size = Number(buf.readBigUInt64BE(at + 2 + nameLen))
    const start = at + 2 + nameLen + 8
    if (start + size > buf.length) throw new Error(`Packed file ${name} is truncated`)
    files.push({ name, data: buf.subarray(start, start + size) })
    at = start + size
  }
  return files
}

// ── compress ─────────────────────────────────────────────────────────────────

export function compress(buf) {
  return brotliCompressSync(buf, {
    params: {
      [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
      [zlibConstants.BROTLI_PARAM_QUALITY]: 9,
      [zlibConstants.BROTLI_PARAM_LGWIN]: 24,
      [zlibConstants.BROTLI_PARAM_SIZE_HINT]: buf.length,
    },
  })
}

export function decompress(buf) {
  return brotliDecompressSync(buf)
}

// ── encrypt ──────────────────────────────────────────────────────────────────
// Layout: MAGIC | u16 wrappedKeyLength | wrappedKey | iv(12) | tag(16) | ciphertext

/** Short id of a public key, recorded in each manifest to tell which key opens it. */
export function keyFingerprint(publicKeyPem) {
  const der = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' })
  return sha256(der).slice(0, 16)
}

export function encrypt(plain, publicKeyPem) {
  const aesKey = randomBytes(32)
  const iv = randomBytes(12)
  const wrapped = publicEncrypt(
    { key: publicKeyPem, padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    aesKey,
  )
  const cipher = createCipheriv('aes-256-gcm', aesKey, iv)
  cipher.setAAD(MAGIC)
  const body = Buffer.concat([cipher.update(plain), cipher.final()])
  const len = Buffer.alloc(2)
  len.writeUInt16BE(wrapped.length, 0)
  return Buffer.concat([MAGIC, len, wrapped, iv, cipher.getAuthTag(), body])
}

/** Throws on a wrong key or any altered byte (GCM authentication). */
export function decrypt(buf, privateKeyPem, passphrase) {
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Not an encrypted backup')
  let at = MAGIC.length
  const wrappedLen = buf.readUInt16BE(at)
  at += 2
  const wrapped = buf.subarray(at, at + wrappedLen)
  at += wrappedLen
  const iv = buf.subarray(at, at + 12)
  const tag = buf.subarray(at + 12, at + 28)
  const body = buf.subarray(at + 28)
  const key = createPrivateKey(passphrase ? { key: privateKeyPem, passphrase } : privateKeyPem)
  const aesKey = privateDecrypt({ key, padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, wrapped)
  const decipher = createDecipheriv('aes-256-gcm', aesKey, iv)
  decipher.setAAD(MAGIC)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(body), decipher.final()])
}

// ── split ────────────────────────────────────────────────────────────────────

export function splitParts(buf, size = PART_BYTES) {
  const parts = []
  for (let at = 0; at < buf.length; at += size) parts.push(buf.subarray(at, at + size))
  return parts.length ? parts : [buf]
}

// ── Workers KV (REST API, same calls as src/lib/evidence-store.ts) ───────────

/**
 * @typedef {object} KvStore
 * @property {(key: string, bytes: Uint8Array) => Promise<void>} put
 * @property {(key: string) => Promise<Buffer | null>} get
 * @property {(prefix: string) => Promise<string[]>} list
 * @property {(key: string) => Promise<void>} delete
 */

/**
 * @param {{ accountId: string, namespaceId: string, token: string, fetchImpl?: typeof fetch }} cfg
 * @returns {KvStore}
 */
export function kvClient({ accountId, namespaceId, token, fetchImpl = fetch }) {
  const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/storage/kv/namespaces/${encodeURIComponent(namespaceId)}`
  const auth = { Authorization: `Bearer ${token}` }
  const valueUrl = key => `${base}/values/${encodeURIComponent(key)}`
  const fail = async (what, res) => new Error(`KV ${what} failed: ${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`)

  return {
    async put(key, bytes) {
      const res = await fetchImpl(valueUrl(key), {
        method: 'PUT',
        headers: { ...auth, 'Content-Type': 'application/octet-stream' },
        body: bytes,
      })
      if (!res.ok) throw await fail(`put ${key}`, res)
    },
    /** null when the key does not exist (yet — KV may take up to a minute to show a new value). */
    async get(key) {
      const res = await fetchImpl(valueUrl(key), { headers: auth })
      if (res.status === 404) return null
      if (!res.ok) throw await fail(`get ${key}`, res)
      return Buffer.from(await res.arrayBuffer())
    },
    async list(prefix) {
      const names = []
      let cursor = ''
      do {
        const q = new URLSearchParams({ prefix, limit: '1000' })
        if (cursor) q.set('cursor', cursor)
        const res = await fetchImpl(`${base}/keys?${q}`, { headers: auth })
        if (!res.ok) throw await fail('list', res)
        const json = await res.json()
        for (const k of json.result ?? []) names.push(k.name)
        cursor = json.result_info?.cursor ?? ''
      } while (cursor)
      return names
    },
    async delete(key) {
      const res = await fetchImpl(valueUrl(key), { method: 'DELETE', headers: auth })
      if (!res.ok && res.status !== 404) throw await fail(`delete ${key}`, res)
    },
  }
}

// ── backup set on KV ─────────────────────────────────────────────────────────

const partKey = (prefix, id, n) => `${prefix}${id}/part-${String(n).padStart(3, '0')}`
const manifestKey = (prefix, id) => `${prefix}${id}/${MANIFEST_NAME}`

/**
 * Builds the encrypted payload and its manifest (no network).
 * @param {{ name: string, data: Buffer }[]} files
 */
export function buildBackup(files, { publicKeyPem, id = backupId(), reason = 'manual', source = {}, prefix = DEFAULT_PREFIX }) {
  const packed = packFiles(files)
  const compressed = compress(packed)
  const encrypted = encrypt(compressed, publicKeyPem)
  if (encrypted.length > MAX_ENCRYPTED_BYTES) {
    throw new Error(`Backup is ${encrypted.length} bytes, over the ${MAX_ENCRYPTED_BYTES}-byte KV budget — move backups to R2`)
  }
  const parts = splitParts(encrypted)
  const manifest = {
    format: 'eduquest-db-backup',
    version: 1,
    id,
    createdAt: new Date().toISOString(),
    reason,
    source,
    keyFingerprint: keyFingerprint(publicKeyPem),
    files: files.map(f => ({ name: f.name, bytes: f.data.length, sha256: sha256(f.data) })),
    plainBytes: packed.length,
    compressedBytes: compressed.length,
    encryptedBytes: encrypted.length,
    sha256: sha256(encrypted),
    parts: parts.map((p, n) => ({ key: partKey(prefix, id, n), bytes: p.length, sha256: sha256(p) })),
  }
  return { manifest, parts }
}

/** Parts first, manifest last: a backup without a manifest is an unfinished one. */
export async function uploadBackup(kv, { manifest, parts }, prefix = DEFAULT_PREFIX) {
  for (let n = 0; n < parts.length; n++) await kv.put(manifest.parts[n].key, parts[n])
  await kv.put(manifestKey(prefix, manifest.id), Buffer.from(JSON.stringify(manifest, null, 2)))
}

/** KV is eventually consistent: a fresh value can 404 for up to ~60 s. */
async function getWithRetry(kv, key, { attempts = 8, delayMs = 5000, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  for (let i = 0; i < attempts; i++) {
    const v = await kv.get(key)
    if (v) return v
    if (i < attempts - 1) await sleep(delayMs * (i + 1))
  }
  return null
}

export async function readManifest(kv, id, prefix = DEFAULT_PREFIX, retry) {
  const raw = await getWithRetry(kv, manifestKey(prefix, id), retry)
  if (!raw) throw new Error(`Backup ${id} has no manifest`)
  return JSON.parse(raw.toString('utf8'))
}

/** Downloads every part and checks each hash and the whole-file hash. */
export async function downloadBackup(kv, manifest, retry) {
  const parts = []
  for (const p of manifest.parts) {
    const buf = await getWithRetry(kv, p.key, retry)
    if (!buf) throw new Error(`Missing part ${p.key}`)
    if (sha256(buf) !== p.sha256) throw new Error(`Part ${p.key} is corrupted`)
    parts.push(buf)
  }
  const encrypted = Buffer.concat(parts)
  if (sha256(encrypted) !== manifest.sha256) throw new Error(`Backup ${manifest.id} does not match its manifest`)
  return encrypted
}

/** Encrypted bytes → the original files. */
export function openBackup(encrypted, privateKeyPem, passphrase) {
  return unpackFiles(decompress(decrypt(encrypted, privateKeyPem, passphrase)))
}

/** Groups KV key names into backups, newest first. */
export function groupBackups(keyNames, prefix = DEFAULT_PREFIX) {
  const byId = new Map()
  for (const name of keyNames) {
    if (!name.startsWith(prefix)) continue
    const [id, file] = name.slice(prefix.length).split('/')
    if (!id || !file) continue
    const entry = byId.get(id) ?? { id, keys: [], complete: false }
    entry.keys.push(name)
    if (file === MANIFEST_NAME) entry.complete = true
    byId.set(id, entry)
  }
  return [...byId.values()].sort((a, b) => (a.id < b.id ? 1 : -1))
}

/**
 * What to delete: complete backups beyond the newest `keep` or past the byte
 * `budget` (sizes by id, from the manifests), and unfinished leftovers of
 * failed runs. Never the backup just written (`currentId`).
 */
export function planPrune(groups, keep = DEFAULT_KEEP, currentId, { sizes = {}, budget = BUDGET_BYTES } = {}) {
  const doomed = []
  let kept = 0
  let used = 0
  let full = false
  for (const g of groups) {
    const size = sizes[g.id] ?? 0
    if (g.id === currentId) { if (g.complete) { kept++; used += size } continue }
    if (!g.complete) { doomed.push(g); continue }
    // Newest first: once a copy does not fit, every older one goes too.
    if (!full && kept < keep && used + size <= budget) { kept++; used += size }
    else { full = true; doomed.push(g) }
  }
  return doomed
}
