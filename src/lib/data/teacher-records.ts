import type { SupabaseClient } from '@/lib/db'
import { IncompleteReadError, inBatches, readAllByKeyset, readAllPages, READ_PAGE } from '@/lib/data/complete-read'
import {
  groupStudentRows, isShared, summarizeAttendance,
  type Assessment, type AttendanceStatus, type GroupCard, type GroupData, type GroupInfo, type GroupMember, type Submission,
} from '@/lib/teacher-records'

// ── Teacher records: the reads (PERFORMANCE_CONTRACT.md P2, P4, P5, P10) ─────
//
// Everything here is the teacher's own real data, read through the teacher's
// session (RLS applies). Two checks are app-side on purpose:
//   • groups_select lets a teacher read EVERY group of the institution, so the
//     loaders filter `teacher_id = <teacher>` explicitly: this section shows
//     only the teacher's own groups, and a guessed group id returns null.
//   • exams_select already limits exams to the teacher's own; the explicit
//     `teacher_id` filter repeats it as defence in depth.
//
// Each read is bounded by one group (its roster, sessions, exams and their
// submissions) or by the teacher's own groups; the student record narrows the
// per-student reads to that one student. One group's attendance marks,
// submissions and course progress still grow as members x sessions / exams /
// items, past the API's 1000-row cap, so those three are read completely
// (complete-read.ts): paged, members in short `.in()` batches, and a failed or
// short read throws instead of showing a partial record.

export const GROUP_COLUMNS = 'id, name, description, image_url, is_active, created_at, course_id, courses(title)'

/**
 * The exam columns a record uses. Never `questions`: they were read only to sum
 * their points as a fallback maximum, and a graded item always has the
 * submission's own `max_score` (finalize_exam_submission writes it), so the
 * fallback was never reached — while the questions were ~96% of the bytes.
 */
export const RECORD_EXAM_COLUMNS =
  'id, title, type, lesson_id, created_at, ends_at, group_id, assigned_student_id, counts_toward_grade, source_exam_id, lessons(title)'

/** The submission columns a record uses; `exams!inner()` only filters (by the exam's conditions), it adds no column. */
const RECORD_SUBMISSION_COLUMNS = 'id, exam_id, student_id, score, max_score, grading_status, status, submitted_at, is_flagged, exams!inner()'
interface SubmissionRow {
  id: string; exam_id: string; student_id: string; score: number | null; max_score: number | null
  grading_status: Submission['gradingStatus'] | null; status: Submission['status'] | null; submitted_at: string | null; is_flagged: boolean | null
}

interface GroupRow {
  id: string; name: string; description: string | null; image_url: string | null; is_active: boolean
  created_at: string; course_id: string | null; courses: { title: string } | null
}

function toGroupInfo(g: GroupRow): GroupInfo {
  return {
    id: g.id, name: g.name, description: g.description, imageUrl: g.image_url, isActive: g.is_active,
    createdAt: g.created_at, courseId: g.course_id, courseTitle: g.courses?.title ?? null,
  }
}

/**
 * Everything one group's record needs, or null when it is not the teacher's group.
 * With `studentId` (the student record) the roster, submissions, attendance marks
 * and course progress are read for that one student only.
 */
export async function loadGroupData(
  supabase: SupabaseClient, teacherId: string, groupId: string, opts: { studentId?: string } = {},
): Promise<GroupData | null> {
  const { data: g } = await supabase
    .from('groups').select(GROUP_COLUMNS).eq('id', groupId).eq('teacher_id', teacherId).maybeSingle()
  if (!g) return null
  return loadGroupDetails(supabase, teacherId, toGroupInfo(g as unknown as GroupRow), { studentId: opts.studentId, withProgress: true })
}

/**
 * The group's data once the group itself is known (and known to be the
 * teacher's). Two rounds: everything that depends only on the group, then the
 * submissions and course progress, which need the exam and member ids.
 */
async function loadGroupDetails(
  supabase: SupabaseClient, teacherId: string, group: GroupInfo,
  { studentId, withProgress }: { studentId?: string; withProgress: boolean },
): Promise<GroupData> {
  // One student's record: their roster row and marks only (the submissions and
  // progress below follow, as they are read for the roster's ids).
  let memberQuery = supabase.from('group_students').select('student_id, joined_at, users(full_name, email, is_active)').eq('group_id', group.id)
  if (studentId) memberQuery = memberQuery.eq('student_id', studentId)
  // Marks of a group with no session are simply none, so this need not wait for the sessions.
  // Sessions x members: every page, ordered by the table's key (session_id, student_id).
  const onlyStudent = studentId ? { student_id: studentId } : {}
  const marksRead = readAllPages<{ session_id: string; student_id: string; status: AttendanceStatus; note: string | null }>(
    'attendance marks', (from, to, withCount) => supabase.from('attendance_records')
      .select('session_id, student_id, status, note, attendance_sessions!inner(group_id)', withCount ? { count: 'exact' } : undefined)
      .eq('attendance_sessions.group_id', group.id).match(onlyStudent)
      .order('session_id').order('student_id').range(from, to))

  // Exams set on the group itself, plus those set on its linked course.
  const examFilter = group.courseId ? `group_id.eq.${group.id},course_id.eq.${group.courseId}` : `group_id.eq.${group.id}`
  const [{ data: memberRows }, { data: examRows }, { data: sessionRows }, markRows] = await Promise.all([
    memberQuery,
    supabase.from('exams')
      .select(RECORD_EXAM_COLUMNS)
      .eq('teacher_id', teacherId).eq('is_published', true).is('deleted_at', null).or(examFilter),
    supabase.from('attendance_sessions').select('id, session_date, title').eq('group_id', group.id).order('session_date', { ascending: false }),
    marksRead,
  ])

  const members: GroupMember[] = ((memberRows ?? []) as unknown as {
    student_id: string; joined_at: string | null; users: { full_name: string | null; email: string | null; is_active: boolean | null } | null
  }[]).map(m => ({
    studentId: m.student_id, name: m.users?.full_name ?? '', email: m.users?.email ?? '',
    isActive: m.users?.is_active !== false, joinedAt: m.joined_at,
  })).sort((a, b) => a.name.localeCompare(b.name))

  const assessments: Assessment[] = ((examRows ?? []) as unknown as {
    id: string; title: string; type: string; lesson_id: string | null; created_at: string; ends_at: string | null
    group_id: string | null; lessons: { title: string } | null
    assigned_student_id: string | null; counts_toward_grade: boolean | null; source_exam_id: string | null
  }[]).map(e => ({
    id: e.id, kind: e.type === 'homework' ? 'homework' : 'exam', title: e.title, lessonId: e.lesson_id,
    lessonTitle: e.lessons?.title ?? null, createdAt: e.created_at, endsAt: e.ends_at,
    // Unknown here (questions are not read): the record's maximum is the submission's max_score.
    maxPoints: 0, source: e.group_id ? 'group' : 'course',
    assignedTo: e.assigned_student_id ?? null, countsTowardGrade: e.counts_toward_grade !== false,
    sourceExamId: e.source_exam_id ?? null,
  }))

  const examIds = assessments.map(a => a.id)
  const memberIds = members.map(m => m.studentId)
  const sessions = ((sessionRows ?? []) as { id: string; session_date: string; title: string | null }[])
    .map(s => ({ id: s.id, date: s.session_date, title: s.title }))

  // Submissions to exactly the exams listed above - filtered through the exam (the
  // same conditions as that read) instead of a list of exam ids - by members, in
  // batches of ids, each read completely by keyset.
  const [subRows, progress] = await Promise.all([
    examIds.length && memberIds.length
      ? inBatches(memberIds, batch => readAllByKeyset<SubmissionRow>('record submissions',
          after => supabase.from('exam_submissions').select(RECORD_SUBMISSION_COLUMNS)
            .eq('exams.teacher_id', teacherId).eq('exams.is_published', true).is('exams.deleted_at', null)
            .or(examFilter, { referencedTable: 'exams' }).in('student_id', batch)
            .gt('id', after).order('id').limit(READ_PAGE),
          () => supabase.from('exam_submissions').select(RECORD_SUBMISSION_COLUMNS, { count: 'exact', head: true })
            .eq('exams.teacher_id', teacherId).eq('exams.is_published', true).is('exams.deleted_at', null)
            .or(examFilter, { referencedTable: 'exams' }).in('student_id', batch)))
      : Promise.resolve([] as SubmissionRow[]),
    withProgress && group.courseId && group.courseTitle && memberIds.length
      ? loadCourseProgress(supabase, group.courseId, memberIds)
      : Promise.resolve(null),
  ])

  const submissions: Submission[] = subRows.map(s => ({
    id: s.id, examId: s.exam_id, studentId: s.student_id,
    score: s.score == null ? null : Number(s.score), maxScore: s.max_score == null ? null : Number(s.max_score),
    gradingStatus: s.grading_status ?? 'pending', status: s.status ?? 'submitted',
    submittedAt: s.submitted_at, flagged: !!s.is_flagged,
  }))

  const marks = markRows
    .map(m => ({ sessionId: m.session_id, studentId: m.student_id, status: m.status, note: m.note }))

  return { group, members, assessments, submissions, sessions, marks, progress }
}

async function loadCourseProgress(supabase: SupabaseClient, courseId: string, studentIds: string[]) {
  // Items x members: by members in batches of ids, each read completely by keyset.
  const [items, rows] = await Promise.all([
    supabase.from('unit_items').select('id', { count: 'exact', head: true }).eq('course_id', courseId).eq('is_published', true),
    inBatches(studentIds, batch => readAllByKeyset<{ id: string; student_id: string }>('course progress',
      after => supabase.from('student_progress')
        .select('id, student_id, unit_items!inner(course_id, is_published)')
        .eq('unit_items.course_id', courseId).eq('unit_items.is_published', true)
        .in('student_id', batch).gt('id', after).order('id').limit(READ_PAGE),
      () => supabase.from('student_progress')
        .select('id, student_id, unit_items!inner(course_id, is_published)', { count: 'exact', head: true })
        .eq('unit_items.course_id', courseId).eq('unit_items.is_published', true)
        .in('student_id', batch))),
  ])
  if (items.error) throw new IncompleteReadError('course items: count failed', items.error)
  const done = new Map<string, number>()
  for (const p of rows) done.set(p.student_id, (done.get(p.student_id) ?? 0) + 1)
  return { total: items.count ?? 0, done }
}

/** Every group the teacher owns, with headline numbers. */
export async function loadGroupCards(supabase: SupabaseClient, teacherId: string, now: number): Promise<GroupCard[]> {
  const { data: rows } = await supabase
    .from('groups').select(GROUP_COLUMNS).eq('teacher_id', teacherId).order('created_at', { ascending: false })
  const groups = ((rows ?? []) as unknown as GroupRow[]).map(toGroupInfo)
  // Per-group data sets are small (one class each), so reusing the group loader
  // keeps the numbers on the card identical to the ones inside the group. The
  // groups were just read with the teacher filter, so they are passed in rather
  // than read again, and course progress is skipped: no card shows it.
  const all = await Promise.all(groups.map(g => loadGroupDetails(supabase, teacherId, g, { withProgress: false })))
  return all.map(d => {
    const students = groupStudentRows(d, now)
    const graded = students.flatMap(s => (s.summary.overallAvg == null ? [] : [s.summary.overallAvg]))
    const att = summarizeAttendance(d.marks.map(m => ({ sessionId: m.sessionId, date: '', title: null, status: m.status, note: null })))
    return {
      group: d.group,
      students: d.members.length,
      // Work set for the whole group; individual tasks are counted per student.
      exams: d.assessments.filter(a => isShared(a) && a.kind === 'exam').length,
      homework: d.assessments.filter(a => isShared(a) && a.kind === 'homework').length,
      avg: graded.length ? Math.round(graded.reduce((a, x) => a + x, 0) / graded.length) : null,
      attendanceRate: att.rate,
      atRisk: students.filter(s => s.summary.atRisk).length,
    }
  })
}
