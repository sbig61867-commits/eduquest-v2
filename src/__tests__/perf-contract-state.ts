/**
 * Performance Contract ratchet — the grandfathered backlog (PERFORMANCE_CONTRACT.md).
 *
 * Captured 2026-09-30 (Batch 0) from src/__tests__/perf-contract-scan.ts. Each
 * map is file (relative to src/) → number of sites. The ratchet in
 * perf-contract.test.ts fails when a file goes ABOVE its number (a new
 * violation) and also when it goes BELOW (a fix that forgot to lower it here),
 * so these numbers only ever move down, one reviewed diff at a time.
 *
 * Raising a number is possible but must be a deliberate, reviewed decision
 * with a reason in the PR — never a way to make the test pass.
 */

/** .select('*…') on a read (row shape = whatever the table grows into). */
export const STAR_SELECT: Readonly<Record<string, number>> = {
  'app/api/exam/answer-file/route.ts': 1,
  'lib/seat-limit.ts': 2,
  'lib/storage-quota.ts': 1,
}

/** Reads with no limit/range/single/maybeSingle/head count/eq('id'). */
export const UNBOUNDED_READS: Readonly<Record<string, number>> = {
  // 1 — the courses list (out of B's approved scope). The groups are now one server page,
  //     head-only totals and a complete paged read for the transfer picker (lib/data/center-groups.ts).
  // 1 — listByRole (listStudents / listTeachers / listCenterStudents / listCenterTeachers):
  //     bounded by .range() on the same builder, built over two statements
  //     (conditional search) — the scanner's known blind spot. Counts are head-only.
  // 2 — listCenterTeachers footprints (groups, courses): restricted to the current
  //     page's teachers (.in('teacher_id', ids), at most 50 teachers) and used only
  //     server-side to decide each teacher's lock state — never sent to the browser
  //     (only the lock flag is). NOT hard-row-limited: the row count is however many
  //     live groups/courses those ≤ 50 teachers own. A .limit() could cut a teacher's
  //     rows and flip the lock. Moved here from center/teachers/page.tsx, which read
  //     all three tables whole (3 → 0 there). Allowance raised 1 → 3 with the owner's
  //     approval (2026-10-01); an aggregate RPC is the later option, not now.
  // 4 — loadStudentCourseList (moved from student/courses/page.tsx, 4 → 0 there, Batch 4 / P-06):
  //     enrolments, transfers and group memberships are filtered on student_id = the caller,
  //     the courses on .in('id', the caller's enrolled course ids) — each is bounded by the
  //     student's own enrolments / memberships / transfers, not by the institution's size.
}

/** Calls to the heavy feeds listed in HEAVY_FEEDS (perf-contract-scan.ts). */
export const HEAVY_FEED_CALLS: Readonly<Record<string, number>> = {}
