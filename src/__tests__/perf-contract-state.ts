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
  'app/(admin)/admin/academic/page.tsx': 1,
  'app/(admin)/admin/settings/page.tsx': 1,
  'app/(auth)/change-password/page.tsx': 1,
  'app/(center)/center/groups/page.tsx': 1,
  'app/(student)/student/exams/page.tsx': 1,
  'app/(student)/student/profile/page.tsx': 1,
  'app/(super-admin)/super-admin/tenants/page.tsx': 1,
  'app/(teacher)/teacher/courses/[id]/page.tsx': 3,
  'app/(teacher)/teacher/courses/page.tsx': 1,
  'app/(teacher)/teacher/groups/page.tsx': 1,
  'app/(teacher)/teacher/lessons/[id]/page.tsx': 2,
  'app/api/admin/create-user/route.ts': 1,
  'app/api/admin/tenant-users/route.ts': 1,
  'app/api/appeals/report/route.ts': 1,
  'app/api/courses/create-full/route.ts': 1,
  'app/api/exam/answer-file/route.ts': 1,
  'app/api/exam/submit/route.ts': 1,
  'app/api/exams/results/route.ts': 2,
  'app/api/group-students/route.ts': 1,
  'app/api/homework/route.ts': 1,
  'app/api/invitations/[id]/route.ts': 1,
  'app/api/invitations/route.ts': 2,
  'app/api/mail/send/route.ts': 1,
  'app/api/proctor/events/route.ts': 1,
  'app/api/proctor/evidence/clip/route.ts': 1,
  'app/api/proctor/evidence/route.ts': 1,
  'app/api/proctor/live-token/route.ts': 1,
  'lib/announcements-data.ts': 1,
  'lib/seat-limit.ts': 2,
  'lib/storage-quota.ts': 1,
  'lib/structure-mode.ts': 2,
}

/** Reads with no limit/range/single/maybeSingle/head count/eq('id'). */
export const UNBOUNDED_READS: Readonly<Record<string, number>> = {
  'app/(admin)/admin/academic/page.tsx': 2,
  'app/(admin)/admin/appeals/page.tsx': 1,
  'app/(admin)/admin/center-staff/page.tsx': 1,
  'app/(admin)/admin/courses/page.tsx': 1,
  'app/(admin)/admin/groups/page.tsx': 4,
  'app/(admin)/admin/invitations/page.tsx': 1,
  'app/(center)/center/attendance/page.tsx': 1,
  'app/(center)/center/courses/page.tsx': 1,
  'app/(center)/center/groups/page.tsx': 2,
  'app/(center)/center/mail/page.tsx': 1,
  'app/(student)/student/courses/[id]/page.tsx': 4,
  'app/(student)/student/dashboard/page.tsx': 1,
  'app/(student)/student/exams/page.tsx': 2,
  'app/(student)/student/grades/page.tsx': 2,
  'app/(student)/student/lessons/page.tsx': 2,
  'app/(student)/student/notifications/page.tsx': 1,
  'app/(student)/student/profile/page.tsx': 4,
  'app/(super-admin)/super-admin/invitations/page.tsx': 1,
  'app/(super-admin)/super-admin/permissions/page.tsx': 1,
  'app/(super-admin)/super-admin/reports/page.tsx': 1,
  'app/(super-admin)/super-admin/tenants/page.tsx': 1,
  'app/(super-admin)/super-admin/users/page.tsx': 2,
  'app/(teacher)/teacher/attendance/page.tsx': 1,
  'app/(teacher)/teacher/courses/[id]/page.tsx': 3,
  'app/(teacher)/teacher/courses/page.tsx': 1,
  'app/(teacher)/teacher/engagement/page.tsx': 1,
  'app/(teacher)/teacher/exams/page.tsx': 4,
  'app/(teacher)/teacher/groups/page.tsx': 1,
  'app/(teacher)/teacher/invitations/page.tsx': 1,
  'app/(teacher)/teacher/lessons/[id]/page.tsx': 2,
  'app/(teacher)/teacher/lessons/page.tsx': 1,
  'app/(teacher)/teacher/proctoring/live/[examId]/live-monitor.tsx': 1,
  'app/(teacher)/teacher/proctoring/page.tsx': 2,
  'app/api/admin/member-lookup/route.ts': 2,
  'app/api/admin/tenant-users/route.ts': 1,
  'app/api/ai/quota/route.ts': 1,
  'app/api/announcements/interested/route.ts': 2,
  'app/api/announcements/route.ts': 1,
  'app/api/appeals/report/route.ts': 1,
  'app/api/attendance/route.ts': 3,
  'app/api/course-enrollments/route.ts': 1,
  'app/api/exams/results/route.ts': 1,
  'app/api/grades/export/route.ts': 2,
  'app/api/group-students/route.ts': 1,
  'app/api/homework/route.ts': 1,
  'app/api/homework/submissions/route.ts': 2,
  'app/api/invitations/route.ts': 1,
  'app/api/mail/connection/route.ts': 1,
  'app/api/mail/send/route.ts': 1,
  'app/api/proctor/evidence/route.ts': 2,
  'app/api/surveys/respond/route.ts': 3,
  'components/student/quick-access-panel.tsx': 2,
  'lib/account-scope.ts': 2,
  'lib/announcements-data.ts': 2,
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
  'lib/data/people.ts': 3,
  // 4 — loadStudentCourseList (moved from student/courses/page.tsx, 4 → 0 there, Batch 4 / P-06):
  //     enrolments, transfers and group memberships are filtered on student_id = the caller,
  //     the courses on .in('id', the caller's enrolled course ids) — each is bounded by the
  //     student's own enrolments / memberships / transfers, not by the institution's size.
  'lib/data/student-courses.ts': 4,
  // 4 — teacher records (moved from lib/teacher-records.ts, 7 → 0 there, P-10): the teacher's
  //     own groups (teacher_id), and per group its roster, exams (named columns, no questions)
  //     and sessions. Each is bounded by one group; the student record narrows the roster to
  //     one student. Marks, submissions and course progress (members × sessions / exams / items,
  //     past the 1000-row cap) are now read completely — paged, members in id batches (B / C1),
  //     7 → 4.
  'lib/data/teacher-records.ts': 4,
  'lib/requests-data.ts': 3,
  'lib/schedules-data.ts': 6,
}

/** Calls to the heavy feeds listed in HEAVY_FEEDS (perf-contract-scan.ts). */
export const HEAVY_FEED_CALLS: Readonly<Record<string, number>> = {}
