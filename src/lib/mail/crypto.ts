import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

// AES-256-GCM for OAuth tokens at rest, and HMAC for the OAuth `state`.
// MAIL_TOKEN_ENCRYPTION_KEY: 32 random bytes, base64 — generate with
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

function key(): Buffer {
  const raw = process.env.MAIL_TOKEN_ENCRYPTION_KEY
  if (!raw) throw new Error('MAIL_TOKEN_ENCRYPTION_KEY is not set')
  const k = Buffer.from(raw, 'base64')
  if (k.length !== 32) throw new Error('MAIL_TOKEN_ENCRYPTION_KEY must be 32 bytes (base64)')
  return k
}

/** iv.tag.ciphertext, each base64url */
export function encrypt(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), data].map(b => b.toString('base64url')).join('.')
}

export function decrypt(payload: string): string {
  const [iv, tag, data] = payload.split('.').map(p => Buffer.from(p, 'base64url'))
  if (!iv || !tag || !data) throw new Error('Malformed encrypted payload')
  const decipher = createDecipheriv('aes-256-gcm', key(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

/** Signed, expiring OAuth state bound to the user who started the flow. */
export function signState(userId: string, ttlSeconds = 600): string {
  const body = Buffer.from(JSON.stringify({ u: userId, e: Date.now() + ttlSeconds * 1000, n: randomBytes(8).toString('hex') })).toString('base64url')
  const sig = createHmac('sha256', key()).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verifyState(state: string | null, userId: string): boolean {
  if (!state) return false
  const [body, sig] = state.split('.')
  if (!body || !sig) return false
  const expected = createHmac('sha256', key()).update(body).digest()
  const given = Buffer.from(sig, 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false
  try {
    const { u, e } = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { u: string; e: number }
    return u === userId && Date.now() < e
  } catch {
    return false
  }
}
