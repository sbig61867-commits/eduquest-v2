/**
 * Where the i18n extraction has reached.
 *
 * MIGRATED_DIRS  — areas that must contain NO Arabic literal. A phase adds
 *                  its area here when it finishes.
 * Per-language CONTENT that is not UI — AI prompts, demo fixtures, pricing
 * wording — lives in src/content/<area>/{ar,en}.ts (outside the scanned dirs),
 * one language per file, checked against a shared type.
 *
 * UNMIGRATED_FILES — the grandfathered backlog, captured at the start of the
 *                  migration. It may only ever shrink; the ratchet test in
 *                  i18n-no-hardcoded-strings.test.ts fails on any addition,
 *                  and also on any entry that has become clean but was left
 *                  behind.
 */

/** Paths relative to `src/`. Prefixes, matched with startsWith. */
export const MIGRATED_DIRS: readonly string[] = [
  'app/(student)/', // Phase 1
  'app/(teacher)/', // Phase 2
  'app/(center)/',  // Phase 3
  'app/(admin)/',   // Phase 3
  'app/(auth)/',    // Phase 6
  'app/demo/',      // Phase 6
  'components/center/',
  'components/announcements/',
  'components/schedules/',
  'components/requests/',
  'components/mail/',
  'components/admin/',
  'components/student/', // Phase 1 debt, closed in Phase 3
  'components/demo/',
  'app/(super-admin)/', // Phase 8
  'components/public/',  // Phase 9 — marketing pages, now /<locale>/ URLs
  'components/teacher/',
  'components/shared/',
  'components/ui/',
]

export const UNMIGRATED_FILES: readonly string[] = [
  // Empty: every UI string is in src/messages, and every piece of per-language
  // content (AI prompts, demo data, pricing, institution vocabulary) is in
  // src/content. The ratchet keeps it empty — any new file with hardcoded
  // Arabic fails the suite.
]
