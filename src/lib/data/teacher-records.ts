import { run, type Sql } from '@/lib/db/sql'
import {
  groupStudentRows, isShared, summarizeAttendance,
  type Assessment, type AttendanceStatus, type GroupCard, type GroupData, type GroupInfo, type GroupMember, type Submission,
} from '@/lib/teacher-records'

// ── Teacher records: the reads (PERFORMANCE_CONTRACT.md P2, P4, P5, P10) ─────
//
// Everything here is the teacher's own real data, read as the teacher (RLS
// applies). Two checks are app-side on purpose:
//   • groups_select lets a teacher read EVERY group of the institution, so the
//     loaders filter `teacher_id = <teacher>` explicitly: this section shows
//     only the teacher's own groups, and a guessed group id returns nothing.
//   • exams_select already limits exams to the teacher's own; the explicit
//     `teacher_id` filter repeats it as defence in depth.
//
// One group's record is ONE unit: the group, its roster, exams, sessions,
// marks, submissions and course progress, each a statement keyed by the group
// itself (joins, not id lists), so nothing is paged or batched — SQL has no
// row cap to cut a result short. The student record narrows the per-student
// statements to that one student.

export const RECORD_EXAM_COLUMNS =
  'id, title, type, lesson_id, created_at, ends_at, group_id, assigned_student_id, counts_toward_grade, source_exam_id, lessons(title)'

interface SubmissionRow {
  id: string; exam_id: string; student_id: string; score: number | null; max_score: number | null
  grading_status: Submission['gradingStatus'] | null; status: Submission['status'] | null; submitted_at: string | null; is_flagged: boolean | null
}

interface GroupRow {
  id: string; name: string; description: string | null; image_url: string | null; is_active: boolean
  created_at: string; course_id: string | null; course_title: string | null
}

function toGroupInfo(g: GroupRow): GroupInfo {
  return {
    id: g.id, name: g.name, description: g.description, imageUrl: g.image_url, isActive: g.is_active,
    createdAt: g.created_at, courseId: g.course_id, courseTitle: g.course_title,
  }
}

const groupsOf = (sql: Sql, teacherId: string, groupId: string | null) => sql`
  select g.id, g.name, g.description, g.image_url, g.is_active, g.created_at, g.course_id, c.title as course_title
    from public.groups g left join public.courses c on c.id = g.course_id
   where g.teacher_id = ${teacherId} and (${groupId}::uuid is null or g.id = ${groupId}::uuid)
   order by g.created_at desc`

/** Statements per group in detailStatements(). */
const PER_GROUP = 6

/**
 * The statements of one group's record. Exams are those set on the group itself
 * plus those set on its linked course; submissions are to exactly those exams
 * (same conditions), by the group's members.
 */
function detailStatements(sql: Sql, teacherId: string, groupId: string, studentId: string | null, withProgress: boolean) {
  const exams = sql`
    select e.id from public.exams e join public.groups g on g.id = ${groupId}
     where e.teacher_id = ${teacherId} and e.is_published and e.deleted_at is null
       and (e.group_id = g.id or (g.course_id is not null and e.course_id = g.course_id))`
  const members = sql`
    select gs.student_id from public.group_students gs
     where gs.group_id = ${groupId} and (${studentId}::uuid is null or gs.student_id = ${studentId}::uuid)`
  return [
    sql`select gs.student_id, gs.joined_at, u.full_name, u.email, u.is_active
          from public.group_students gs left join public.users u on u.id = gs.student_id
         where gs.group_id = ${groupId} and (${studentId}::uuid is null or gs.student_id = ${studentId}::uuid)`,
    sql`select e.id, e.title, e.type, e.lesson_id, e.created_at, e.ends_at, e.group_id, e.assigned_student_id,
               e.counts_toward_grade, e.source_exam_id, l.title as lesson_title
          from public.exams e left join public.lessons l on l.id = e.lesson_id
         where e.id in (${exams})`,
    sql`select id, session_date, title from public.attendance_sessions where group_id = ${groupId} order by session_date desc`,
    sql`select r.session_id, r.student_id, r.status, r.note
          from public.attendance_records r join public.attendance_sessions s on s.id = r.session_id
         where s.group_id = ${groupId} and (${studentId}::uuid is null or r.student_id = ${studentId}::uuid)
         order by r.session_id, r.student_id`,
    sql`select id, exam_id, student_id, score, max_score, grading_status, status, submitted_at, is_flagged
          from public.exam_submissions
         where exam_id in (${exams}) and student_id in (${members}) order by id`,
    withProgress
      ? sql`select (select count(*)::int from public.unit_items i join public.groups g on g.id = ${groupId}
                     where i.course_id = g.course_id and i.is_published) as total,
                   coalesce((select json_object_agg(d.student_id, d.n) from (
                     select p.student_id, count(*)::int as n
                       from public.student_progress p
                       join public.unit_items i on i.id = p.unit_item_id and i.is_published
                       join public.groups g on g.id = ${groupId} and i.course_id = g.course_id
                      where p.student_id in (${members}) group by p.student_id) d), '{}') as done`
      : sql`select null::int as total`,
  ]
}

function toGroupData(group: GroupInfo, [memberRows, examRows, sessionRows, markRows, subRows, progRows]: unknown[][], withProgress: boolean): GroupData {
  const members: GroupMember[] = (memberRows as {
    student_id: string; joined_at: string | null; full_name: string | null; email: string | null; is_active: boolean | null
  }[]).map(m => ({
    studentId: m.student_id, name: m.full_name ?? '', email: m.email ?? '',
    isActive: m.is_active !== false, joinedAt: m.joined_at,
  })).sort((a, b) => a.name.localeCompare(b.name))

  const assessments: Assessment[] = (examRows as {
    id: string; title: string; type: string; lesson_id: string | null; created_at: string; ends_at: string | null
    group_id: string | null; lesson_title: string | null
    assigned_student_id: string | null; counts_toward_grade: boolean | null; source_exam_id: string | null
  }[]).map(e => ({
    id: e.id, kind: e.type === 'homework' ? 'homework' : 'exam', title: e.title, lessonId: e.lesson_id,
    lessonTitle: e.lesson_title, createdAt: e.created_at, endsAt: e.ends_at,
    // Unknown here (questions are not read): the record's maximum is the submission's max_score.
    maxPoints: 0, source: e.group_id ? 'group' : 'course',
    assignedTo: e.assigned_student_id ?? null, countsTowardGrade: e.counts_toward_grade !== false,
    sourceExamId: e.source_exam_id ?? null,
  }))

  const sessions = (sessionRows as { id: string; session_date: string; title: string | null }[])
    .map(x => ({ id: x.id, date: x.session_date, title: x.title }))

  const submissions: Submission[] = (subRows as SubmissionRow[]).map(x => ({
    id: x.id, examId: x.exam_id, studentId: x.student_id,
    score: x.score == null ? null : Number(x.score), maxScore: x.max_score == null ? null : Number(x.max_score),
    gradingStatus: x.grading_status ?? 'pending', status: x.status ?? 'submitted',
    submittedAt: x.submitted_at, flagged: !!x.is_flagged,
  }))

  const marks = (markRows as { session_id: string; student_id: string; status: AttendanceStatus; note: string | null }[])
    .map(m => ({ sessionId: m.session_id, studentId: m.student_id, status: m.status, note: m.note }))

  const prog = (progRows as { total: number | null; done?: Record<string, number> }[])[0]
  const progress = withProgress && group.courseId && group.courseTitle && members.length && prog
    ? { total: prog.total ?? 0, done: new Map(Object.entries(prog.done ?? {})) }
    : null

  return { group, members, assessments, submissions, sessions, marks, progress }
}

/**
 * Everything one group's record needs, or null when it is not the teacher's group.
 * With `studentId` (the student record) the roster, submissions, attendance marks
 * and course progress are read for that one student only. One unit.
 */
export async function loadGroupData(
  teacherId: string, groupId: string, opts: { studentId?: string } = {},
): Promise<GroupData | null> {
  const [g, ...rest] = await run({ as: 'user', userId: teacherId }, sql => [
    groupsOf(sql, teacherId, groupId),
    ...detailStatements(sql, teacherId, groupId, opts.studentId ?? null, true),
  ])
  if (!g.length) return null
  return toGroupData(toGroupInfo(g[0] as unknown as GroupRow), rest as unknown[][], true)
}

/** Every group the teacher owns, with headline numbers. Two units. */
export async function loadGroupCards(teacherId: string, now: number): Promise<GroupCard[]> {
  const ctx = { as: 'user' as const, userId: teacherId }
  const [rows] = await run(ctx, sql => [groupsOf(sql, teacherId, null)])
  const groups = (rows as unknown as GroupRow[]).map(toGroupInfo)
  if (!groups.length) return []
  // Per-group data sets are small (one class each), so reusing the group
  // statements keeps the numbers on the card identical to the ones inside the
  // group; every group goes in the same second unit. Course progress is
  // skipped: no card shows it.
  const flat = await run(ctx, sql => groups.flatMap(g => detailStatements(sql, teacherId, g.id, null, false)))
  return groups.map((group, i) => {
    const d = toGroupData(group, flat.slice(i * PER_GROUP, (i + 1) * PER_GROUP) as unknown[][], false)
    const students = groupStudentRows(d, now)
    const graded = students.flatMap(x => (x.summary.overallAvg == null ? [] : [x.summary.overallAvg]))
    const att = summarizeAttendance(d.marks.map(m => ({ sessionId: m.sessionId, date: '', title: null, status: m.status, note: null })))
    return {
      group: d.group,
      students: d.members.length,
      // Work set for the whole group; individual tasks are counted per student.
      exams: d.assessments.filter(a => isShared(a) && a.kind === 'exam').length,
      homework: d.assessments.filter(a => isShared(a) && a.kind === 'homework').length,
      avg: graded.length ? Math.round(graded.reduce((a, x) => a + x, 0) / graded.length) : null,
      attendanceRate: att.rate,
      atRisk: students.filter(x => x.summary.atRisk).length,
    }
  })
}
