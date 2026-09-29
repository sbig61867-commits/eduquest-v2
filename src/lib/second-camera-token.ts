import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * The link a student scans with their phone to add a SECOND CAMERA (a side
 * view of the desk and the screen) to a proctored attempt.
 *
 * Why a phone: browsers cannot see other windows, and tools exist that hide
 * a window from screen capture entirely (the "invisible window" research), so
 * a view of the PHYSICAL screen and desk is the only reliable check — the
 * same idea as ProctorU's second camera. The phone signs in nowhere: the link
 * carries a token that binds one exam to one student, expires, and is signed
 * with a server-side key, so it cannot be forged or moved to another attempt.
 *
 * Token: base64url("<examId>.<studentId>.<expiresAtSec>") "." base64url(HMAC-SHA256)
 * Key:   SECOND_CAMERA_SECRET, else derived from SUPABASE_SERVICE_ROLE_KEY
 *        (never the raw service key itself).
 */

export const SECOND_CAMERA_TTL_SECONDS = 4 * 60 * 60

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function key(): Buffer {
  const explicit = process.env.SECOND_CAMERA_SECRET
  if (explicit) return Buffer.from(explicit)
  const base = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base) throw new Error('No signing key for second-camera tokens')
  return createHmac('sha256', base).update('eduquest:second-camera:v1').digest()
}

const b64url = (b: Buffer) => b.toString('base64url')

function sign(payload: string): string {
  return b64url(createHmac('sha256', key()).update(payload).digest())
}

export function createSecondCameraToken(examId: string, studentId: string, nowSec = Math.floor(Date.now() / 1000)): string {
  const payload = `${examId}.${studentId}.${nowSec + SECOND_CAMERA_TTL_SECONDS}`
  return `${b64url(Buffer.from(payload))}.${sign(payload)}`
}

export function verifySecondCameraToken(token: string | null | undefined, nowSec = Math.floor(Date.now() / 1000)):
  { examId: string; studentId: string; expiresAt: number } | null {
  if (!token || token.length > 400) return null
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  let payload: string
  try { payload = Buffer.from(token.slice(0, dot), 'base64url').toString('utf8') } catch { return null }
  const expected = Buffer.from(sign(payload))
  const given = Buffer.from(token.slice(dot + 1))
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  const [examId, studentId, exp] = payload.split('.')
  const expiresAt = Number(exp)
  if (!UUID.test(examId ?? '') || !UUID.test(studentId ?? '') || !Number.isFinite(expiresAt) || expiresAt <= nowSec) return null
  return { examId, studentId, expiresAt }
}
