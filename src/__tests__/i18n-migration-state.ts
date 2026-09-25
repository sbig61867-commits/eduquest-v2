/**
 * Where the i18n extraction has reached.
 *
 * MIGRATED_DIRS  — areas that must contain NO Arabic literal. A phase adds
 *                  its area here when it finishes.
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
]

export const UNMIGRATED_FILES: readonly string[] = [
  'app/(super-admin)/layout.tsx',
  'app/(super-admin)/super-admin/ai-usage/page.tsx',
  'app/(super-admin)/super-admin/audit/page.tsx',
  'app/(super-admin)/super-admin/dashboard/page.tsx',
  'app/(super-admin)/super-admin/features/features-client.tsx',
  'app/(super-admin)/super-admin/features/page.tsx',
  'app/(super-admin)/super-admin/permissions/page.tsx',
  'app/(super-admin)/super-admin/reports/reports-client.tsx',
  'app/(super-admin)/super-admin/settings/settings-client.tsx',
  'app/(super-admin)/super-admin/tenants/tenants-client.tsx',
  'app/(super-admin)/super-admin/users/users-client.tsx',
  'app/api/ai/announcement-copy/route.ts', // stays: bilingual AI prompt (ar/en pair), not UI
  'app/api/ai/course-suggestions/route.ts', // stays: bilingual AI prompt (ar/en pair), not UI
  'app/api/ai/generate-homework-from-file/route.ts', // stays: Arabic stop-words for content matching
  'app/api/ai/generate-lesson-from-file/route.ts', // stays: prompt examples of Arabic output format; content follows the SOURCE language
  'app/api/appeals/report/route.ts', // Phase 7: xlsx report content
  'app/api/appeals/route.ts', // stays: fallback written into a stored snapshot (data, not UI)
  'app/api/grades/export/route.ts', // Phase 7: xlsx report content
  'app/api/homework/route.ts', // stays: composes a stored exam title (data, not UI)
  'components/public/contact-form.tsx',
  'components/public/contact-page.tsx',
  'components/public/features-page.tsx',
  'components/public/landing.tsx',
  'components/public/mockups.tsx',
  'components/public/policy.tsx',
  'components/public/pricing-page.tsx',
  'components/public/shell.tsx',
  'lib/ai/chat.ts',
  'lib/ai/extract-client.ts',
  'lib/ai/extract.ts',
  'lib/confirm-dialog.tsx',
  'lib/demo/data.ts', // stays: bilingual sample CONTENT by design (ar/en pairs), not UI strings
  'lib/email.ts',
  'lib/group-fields.ts',
  'lib/mail/access.ts',
  'lib/permissions.ts',
  'lib/pricing/plans.ts',
  'lib/reports.ts',
  'lib/staff-auth.ts',
  'lib/student-track.ts',
  'lib/terminology.ts',
  'lib/utils.ts',
]
