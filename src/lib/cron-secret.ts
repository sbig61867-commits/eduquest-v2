import { timingSafeEqual } from 'node:crypto'

/**
 * The one gate of the scheduled-job routes (no user session): the request must
 * carry `Authorization: Bearer <CRON_SECRET>`, compared in constant time. Off
 * (always refused) when the secret is missing or shorter than 16 characters.
 */
export function cronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret || secret.length < 16) return false
  const given = Buffer.from(request.headers.get('authorization') ?? '')
  const expected = Buffer.from(`Bearer ${secret}`)
  return given.length === expected.length && timingSafeEqual(given, expected)
}
