// Client-safe member-ID helpers (IDs look like QOU-S48203917; issued by
// supabase/member_code_migration.sql).
export const MEMBER_CODE_RE = /^[A-Z0-9]{2,6}-[A-Z][0-9]{8}$/

export function normalizeMemberCode(raw: string): string {
  return raw.trim().toUpperCase()
}

export function isMemberCode(raw: string): boolean {
  return MEMBER_CODE_RE.test(normalizeMemberCode(raw))
}
