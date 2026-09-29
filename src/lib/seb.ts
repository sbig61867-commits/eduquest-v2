import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Optional Safe Exam Browser (SEB) requirement for a proctored exam — for
 * high-stakes exams on computers, where a lockdown browser adds what no web
 * page can: no other apps, no copy/paste out, no screen sharing.
 *
 * The teacher builds a SEB configuration (the free SEB Config Tool) whose
 * start URL is the exam page, and pastes its Config Key into the exam
 * (`exams.seb_config_key`, supabase/seb_config_key_migration.sql). The key
 * stays on the server: students cannot read exams rows.
 *
 * SEB's JavaScript API gives the page SHA-256(pageUrl + ConfigKey) — see
 * https://safeexambrowser.org/developer/seb-config-key.html — which only SEB
 * running that exact configuration can produce. /api/exam/start recomputes it
 * and refuses the attempt otherwise. The page URL must be our own exam page,
 * so a hash from another page cannot be replayed.
 *
 * Not proof against everything: SEB itself can be bypassed (e.g. hidden
 * virtual machines), so it is one more layer, not a guarantee.
 */

export const SEB_KEY_RE = /^[0-9a-f]{64}$/

export function normalizeSebKey(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim().toLowerCase()
  return SEB_KEY_RE.test(v) ? v : null
}

/** SHA-256(url + key), hex — what SEB reports as the Config Key hash for `url`. */
export function sebConfigKeyHash(url: string, configKey: string): string {
  return createHash('sha256').update(url + configKey).digest('hex')
}

export interface SebProof { pageUrl?: unknown; configKeyHash?: unknown }

/**
 * True when `proof` shows the request comes from SEB with `configKey`, on an
 * exam page of `origin`.
 */
export function verifySebProof(configKey: string, proof: SebProof | null | undefined, origin: string): boolean {
  if (!proof || typeof proof.pageUrl !== 'string' || typeof proof.configKeyHash !== 'string') return false
  let page: URL
  try { page = new URL(proof.pageUrl) } catch { return false }
  if (page.origin !== origin || !page.pathname.startsWith('/student/')) return false
  const url = page.href.split('#')[0]
  const expected = Buffer.from(sebConfigKeyHash(url, configKey))
  const given = Buffer.from(proof.configKeyHash.trim().toLowerCase())
  return expected.length === given.length && timingSafeEqual(expected, given)
}
