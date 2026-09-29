import { randomInt } from 'crypto'

// Sign-in by member ID (QOU-S48203917, supabase/member_code_migration.sql).
//
// An account created "by ID" has no real email. Supabase Auth still needs one,
// so it gets a placeholder on the reserved `.invalid` TLD (RFC 2606) — nothing
// is ever sent there — and the person signs in with their ID, which
// /api/auth/login-id resolves to that placeholder on the server. The profile
// copy (public.users.email) holds the ID instead, so screens show the ID.

export { MEMBER_CODE_RE, normalizeMemberCode, isMemberCode } from './member-code'

export const PLACEHOLDER_EMAIL_DOMAIN = 'no-email.invalid'

export function placeholderEmail(id: string): string {
  return `${id}@${PLACEHOLDER_EMAIL_DOMAIN}`
}

// Readable temporary password: no 0/O/1/l/I, 10 characters, always a digit.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
export function generateTempPassword(length = 10): string {
  let out = ''
  for (let i = 0; i < length - 1; i++) out += ALPHABET[randomInt(ALPHABET.length)]
  return out + String(randomInt(2, 10))
}
