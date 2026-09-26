import { AwsClient } from 'aws4fetch'
import type { EvidenceExt } from './evidence-keys'

// External store for proctoring evidence snapshots — deliberately NOT Supabase
// (policy: src/lib/evidence-keys.ts). Two interchangeable backends; the first
// one configured wins, and switching is an env change only:
//
// 1. Cloudflare Workers KV (current) — free plan, no payment method. Every
//    snapshot is written with an absolute `expiration`, so Cloudflare itself
//    deletes it at 30 hours even if this app is down. KV list/write calls are
//    capped per day on the free plan, so nothing here lists KV: the index of
//    snapshots is the attempt's own proctoring_events (evidence_key lines).
//      EVIDENCE_KV_ACCOUNT_ID     Cloudflare account id
//      EVIDENCE_KV_NAMESPACE_ID   namespace "eduquest-evidence"
//      EVIDENCE_KV_API_TOKEN      account API token, Workers KV Storage: Edit only
//
// 2. Any S3-compatible bucket, e.g. Cloudflare R2 (needs an R2 subscription).
//    Viewing links are SigV4-signed (aws4fetch); deletion relies on the hourly
//    cleanup + a bucket lifecycle rule.
//      EVIDENCE_S3_ENDPOINT / _BUCKET / _ACCESS_KEY_ID / _SECRET_ACCESS_KEY / _REGION
//
// Neither configured → evidence capture is off: nothing is stored anywhere.

export type EvidenceBackend = 'kv' | 's3'

const CONTENT_TYPE: Record<EvidenceExt, string> = { webp: 'image/webp', jpg: 'image/jpeg' }

// ── Workers KV ───────────────────────────────────────────────────────────────

interface KvConfig { base: string; token: string }

function kvConfig(): KvConfig | null {
  const account = process.env.EVIDENCE_KV_ACCOUNT_ID
  const namespace = process.env.EVIDENCE_KV_NAMESPACE_ID
  const token = process.env.EVIDENCE_KV_API_TOKEN
  if (!account || !namespace || !token) return null
  return {
    base: `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/storage/kv/namespaces/${encodeURIComponent(namespace)}`,
    token,
  }
}

function kvValueUrl(c: KvConfig, key: string): string {
  return `${c.base}/values/${encodeURIComponent(key)}`
}

// ── S3-compatible (R2) ───────────────────────────────────────────────────────

interface S3Config { client: AwsClient; base: string }

function s3Config(): S3Config | null {
  const endpoint = process.env.EVIDENCE_S3_ENDPOINT?.replace(/\/+$/, '')
  const bucket = process.env.EVIDENCE_S3_BUCKET
  const accessKeyId = process.env.EVIDENCE_S3_ACCESS_KEY_ID
  const secretAccessKey = process.env.EVIDENCE_S3_SECRET_ACCESS_KEY
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null
  return {
    client: new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: process.env.EVIDENCE_S3_REGION || 'auto' }),
    base: `${endpoint}/${encodeURIComponent(bucket)}`,
  }
}

function s3ObjectUrl(base: string, key: string): string {
  return `${base}/${key.split('/').map(encodeURIComponent).join('/')}`
}

// ── Public API ───────────────────────────────────────────────────────────────

export function evidenceBackend(): EvidenceBackend | null {
  if (kvConfig()) return 'kv'
  if (s3Config()) return 's3'
  return null
}

export function isEvidenceStoreConfigured(): boolean {
  return evidenceBackend() !== null
}

/** Stores one snapshot. `expiresAtMs` is enforced by the store itself on KV. */
export async function putEvidence(key: string, bytes: Uint8Array, ext: EvidenceExt, expiresAtMs: number): Promise<boolean> {
  const kv = kvConfig()
  if (kv) {
    // KV takes an absolute expiry in epoch seconds (at least 60 s ahead).
    const expiration = Math.max(Math.floor(expiresAtMs / 1000), Math.floor(Date.now() / 1000) + 60)
    const res = await fetch(`${kvValueUrl(kv, key)}?expiration=${expiration}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${kv.token}`, 'Content-Type': 'application/octet-stream' },
      body: bytes as BodyInit,
    })
    if (!res.ok) console.error('[evidence-store] kv put', res.status, await res.text().catch(() => ''))
    return res.ok
  }
  const s3 = s3Config()
  if (!s3) return false
  const res = await s3.client.fetch(s3ObjectUrl(s3.base, key), {
    method: 'PUT',
    body: bytes as BodyInit,
    headers: { 'Content-Type': CONTENT_TYPE[ext], 'Cache-Control': 'private, max-age=600' },
  })
  if (!res.ok) console.error('[evidence-store] s3 put', res.status, await res.text().catch(() => ''))
  return res.ok
}

/** Reads one snapshot's bytes (KV serves images through /api/proctor/evidence/image). */
export async function getEvidence(key: string): Promise<Uint8Array | null> {
  const kv = kvConfig()
  if (kv) {
    const res = await fetch(kvValueUrl(kv, key), { headers: { Authorization: `Bearer ${kv.token}` }, cache: 'no-store' })
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : null
  }
  const s3 = s3Config()
  if (!s3) return null
  const res = await s3.client.fetch(s3ObjectUrl(s3.base, key))
  return res.ok ? new Uint8Array(await res.arrayBuffer()) : null
}

export function contentTypeFor(ext: EvidenceExt): string {
  return CONTENT_TYPE[ext]
}

/**
 * Every key under `prefix` — S3 only (ListObjectsV2, paginated). On KV this
 * returns [] on purpose: list calls are capped on the free plan and never
 * needed, because KV deletes expired snapshots by itself.
 */
export async function listEvidenceKeys(prefix: string, max = 5000): Promise<string[]> {
  const s3 = kvConfig() ? null : s3Config()
  if (!s3) return []
  const keys: string[] = []
  let token: string | null = null
  do {
    const q = new URLSearchParams({ 'list-type': '2', prefix, 'max-keys': '1000' })
    if (token) q.set('continuation-token', token)
    const res = await s3.client.fetch(`${s3.base}?${q}`)
    if (!res.ok) {
      console.error('[evidence-store] s3 list', res.status, await res.text().catch(() => ''))
      break
    }
    const xml = await res.text()
    for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(decodeXml(m[1]))
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
      ? decodeXml(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1] ?? '') || null
      : null
  } while (token && keys.length < max)
  return keys
}

/** Permanently deletes the given keys. Returns how many are gone. */
export async function deleteEvidence(keys: string[]): Promise<number> {
  if (keys.length === 0) return 0
  const kv = kvConfig()
  const s3 = kv ? null : s3Config()
  if (!kv && !s3) return 0
  let removed = 0
  for (let i = 0; i < keys.length; i += 20) {
    const results = await Promise.all(keys.slice(i, i + 20).map(k => {
      const req = kv
        ? fetch(kvValueUrl(kv, k), { method: 'DELETE', headers: { Authorization: `Bearer ${kv.token}` } })
        : s3!.client.fetch(s3ObjectUrl(s3!.base, k), { method: 'DELETE' })
      return req.then(r => r.ok || r.status === 404)
    }))
    removed += results.filter(Boolean).length
  }
  return removed
}

/**
 * Where the teacher's browser loads a snapshot from: a short-lived SigV4 link
 * straight to the bucket (S3), or this app's own authorised image route (KV,
 * whose REST API is never exposed to browsers).
 */
export async function evidenceViewUrl(key: string, seconds: number): Promise<string | null> {
  if (seconds <= 0) return null
  if (kvConfig()) return `/api/proctor/evidence/image?key=${encodeURIComponent(key)}`
  const s3 = s3Config()
  if (!s3) return null
  const url = new URL(s3ObjectUrl(s3.base, key))
  url.searchParams.set('X-Amz-Expires', String(seconds))
  const signed = await s3.client.sign(new Request(url, { method: 'GET' }), { aws: { signQuery: true } })
  return signed.url
}

function decodeXml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}
