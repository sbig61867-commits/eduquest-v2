import type { SupabaseClient } from '@supabase/supabase-js'

// ── Teacher records: groups → students → one student's full record ──────────
//
// Everything here is the teacher's own real data, read through the teacher's
// session (RLS applies). Two checks are app-side on purpose:
//   • groups_select lets a teacher read EVERY group of the institution, so the
//     loaders filter `teacher_id = <teacher>` explicitly: this section shows
//     only the teacher's own groups, and a guessed group id returns null.
//   • exams_select already limits exams to the teacher's own; the explicit
//     `teacher_id` filter repeats it as defence in depth.
//
// The pure functions below turn rows into a student's record. They take `now`
// as an argument so the same inputs always give the same record.

export type Kind = 'exam' | 'homework'

/**
 * graded      submitted and scored (the grade may still be unpublished)
 * awaiting    submitted, not scored yet
 * inProgress  started, never submitted
 * missed      not submitted and the deadline has passed
 * open        not submitted, still open (or no deadline)
 */
export type ItemStatus = 'graded' | 'awaiting' | 'inProgress' | 'missed' | 'open'
export type AttendanceStatus = 'present' | 'late' | 'absent' | 'excused'

export interface Assessment {
  id: string
  kind: Kind
  title: string
  lessonId: string | null
  lessonTitle: string | null
  createdAt: string
  endsAt: string | null
  /** Total points of the questions; 0 when unknown. */
  maxPoints: number
  /** 'course' = set on the group's linked course rather than on the group. */
  source: 'group' | 'course'
}

export interface Submission {
  id: string
  examId: string
  studentId: string
  score: number | null
  maxScore: number | null
  gradingStatus: 'pending' | 'reviewing' | 'published'
  status: 'in_progress' | 'submitted'
  submittedAt: string | null
  flagged: boolean
}

export interface RecordItem {
  assessment: Assessment
  submission: Submission | null
  status: ItemStatus
  /** Score as a percentage of the maximum; null until graded. */
  pct: number | null
  score: number | null
  max: number | null
}

export interface AttendanceMark {
  sessionId: string
  date: string
  title: string | null
  /** null = the student was not marked in this session. */
  status: AttendanceStatus | null
  note: string | null
}

export interface KindSummary {
  assigned: number
  submitted: number
  graded: number
  avg: number | null
}

export interface AttendanceSummary {
  present: number
  late: number
  absent: number
  excused: number
  unmarked: number
  /** (present + late) / (present + late + absent); excused counts on neither side. */
  rate: number | null
}

export interface StudentSummary {
  exams: KindSummary
  homework: KindSummary
  overallAvg: number | null
  /** Submitted share of everything assigned so far. */
  completion: number | null
  attendance: AttendanceSummary
  progress: { done: number; total: number; pct: number | null } | null
  trend: 'up' | 'down' | 'flat' | 'none'
  atRisk: boolean
  lastActivity: string | null
}

/** Averages below this mark a student as at risk. */
export const AT_RISK_BELOW = 50
/** Points between the last two grades before it counts as a trend. */
export const TREND_STEP = 5

/**
 * The request's reference time for server pages. A server component renders
 * once per request, so reading the clock there is correct; it goes through this
 * helper so the one place that does it is explicit (the React purity lint is
 * aimed at client re-renders, where the same read would drift).
 */
export function requestNow(): number {
  return Date.now()
}

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, x) => a + x, 0) / xs.length) : null)

/** When an item happened, for ordering: submission, else deadline, else creation. */
export function itemDate(item: RecordItem): string {
  return item.submission?.submittedAt ?? item.assessment.endsAt ?? item.assessment.createdAt
}

/**
 * One student's items: every assessment that applies to them, with their
 * submission (or its absence) classified. An assessment that closed before the
 * student joined does not apply to them and is left out.
 */
export function buildItems(assessments: Assessment[], subs: Submission[], joinedAt: string | null, now: number): RecordItem[] {
  const byExam = new Map(subs.map(s => [s.examId, s]))
  const joined = joinedAt ? new Date(joinedAt).getTime() : null
  return assessments
    .filter(a => !(joined && a.endsAt && new Date(a.endsAt).getTime() < joined && !byExam.has(a.id)))
    .map(a => {
      const s = byExam.get(a.id) ?? null
      const max = s?.maxScore ?? (a.maxPoints || null)
      let status: ItemStatus
      if (s && s.status === 'submitted') status = s.score != null ? 'graded' : 'awaiting'
      else if (s) status = 'inProgress'
      else status = a.endsAt && new Date(a.endsAt).getTime() < now ? 'missed' : 'open'
      const score = status === 'graded' ? s!.score : null
      const pct = score != null && max ? Math.round((score / max) * 100) : null
      return { assessment: a, submission: s, status, pct, score, max }
    })
    .sort((x, y) => itemDate(y).localeCompare(itemDate(x)))
}

export function summarizeAttendance(marks: AttendanceMark[]): AttendanceSummary {
  const n = { present: 0, late: 0, absent: 0, excused: 0, unmarked: 0 }
  for (const m of marks) n[m.status ?? 'unmarked'] += 1
  const counted = n.present + n.late + n.absent
  return { ...n, rate: counted ? Math.round(((n.present + n.late) / counted) * 100) : null }
}

function summarizeKind(items: RecordItem[]): KindSummary {
  return {
    assigned: items.length,
    submitted: items.filter(i => i.status === 'graded' || i.status === 'awaiting').length,
    graded: items.filter(i => i.status === 'graded').length,
    avg: avg(items.flatMap(i => (i.pct == null ? [] : [i.pct]))),
  }
}

export function summarize(
  items: RecordItem[],
  marks: AttendanceMark[],
  progress: { done: number; total: number } | null,
): StudentSummary {
  const exams = summarizeKind(items.filter(i => i.assessment.kind === 'exam'))
  const homework = summarizeKind(items.filter(i => i.assessment.kind === 'homework'))
  const graded = items.filter(i => i.pct != null).sort((a, b) => itemDate(b).localeCompare(itemDate(a)))
  const overallAvg = avg(graded.map(i => i.pct!))
  const diff = graded.length > 1 ? graded[0].pct! - graded[1].pct! : null
  const assigned = exams.assigned + homework.assigned
  const submittedAt = items.flatMap(i => (i.submission?.submittedAt ? [i.submission.submittedAt] : [])).sort()
  return {
    exams,
    homework,
    overallAvg,
    completion: assigned ? Math.round(((exams.submitted + homework.submitted) / assigned) * 100) : null,
    attendance: summarizeAttendance(marks),
    progress: progress ? { ...progress, pct: progress.total ? Math.round((progress.done / progress.total) * 100) : null } : null,
    trend: diff == null ? 'none' : diff >= TREND_STEP ? 'up' : diff <= -TREND_STEP ? 'down' : 'flat',
    atRisk: overallAvg != null && overallAvg < AT_RISK_BELOW,
    lastActivity: submittedAt.at(-1) ?? null,
  }
}

// ── Loaders (server) ────────────────────────────────────────────────────────

interface QuestionLike { points?: number }
const pointsOf = (questions: unknown) =>
  Array.isArray(questions) ? (questions as QuestionLike[]).reduce((a, q) => a + (Number(q?.points) || 0), 0) : 0

export interface GroupInfo {
  id: string
  name: string
  description: string | null
  imageUrl: string | null
  isActive: boolean
  createdAt: string
  courseId: string | null
  courseTitle: string | null
}

export interface GroupMember {
  studentId: string
  name: string
  email: string
  isActive: boolean
  joinedAt: string | null
}

export interface GroupData {
  group: GroupInfo
  members: GroupMember[]
  assessments: Assessment[]
  submissions: Submission[]
  sessions: { id: string; date: string; title: string | null }[]
  marks: { sessionId: string; studentId: string; status: AttendanceStatus; note: string | null }[]
  /** Completed published items per student, when the group has a readable linked course. */
  progress: { total: number; done: Map<string, number> } | null
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

const GROUP_COLUMNS = 'id, name, description, image_url, is_active, created_at, course_id, courses(title)'

/** Everything one group's record needs, or null when it is not the teacher's group. */
export async function loadGroupData(supabase: SupabaseClient, teacherId: string, groupId: string): Promise<GroupData | null> {
  const { data: g } = await supabase
    .from('groups').select(GROUP_COLUMNS).eq('id', groupId).eq('teacher_id', teacherId).maybeSingle()
  if (!g) return null
  const group = toGroupInfo(g as unknown as GroupRow)

  // Exams set on the group itself, plus those set on its linked course.
  const examFilter = group.courseId ? `group_id.eq.${group.id},course_id.eq.${group.courseId}` : `group_id.eq.${group.id}`
  const [{ data: memberRows }, { data: examRows }, { data: sessionRows }] = await Promise.all([
    supabase.from('group_students').select('student_id, joined_at, users(full_name, email, is_active)').eq('group_id', group.id),
    supabase.from('exams')
      .select('id, title, type, lesson_id, created_at, ends_at, questions, group_id, lessons(title)')
      .eq('teacher_id', teacherId).eq('is_published', true).is('deleted_at', null).or(examFilter),
    supabase.from('attendance_sessions').select('id, session_date, title').eq('group_id', group.id).order('session_date', { ascending: false }),
  ])

  const members: GroupMember[] = ((memberRows ?? []) as unknown as {
    student_id: string; joined_at: string | null; users: { full_name: string | null; email: string | null; is_active: boolean | null } | null
  }[]).map(m => ({
    studentId: m.student_id, name: m.users?.full_name ?? '', email: m.users?.email ?? '',
    isActive: m.users?.is_active !== false, joinedAt: m.joined_at,
  })).sort((a, b) => a.name.localeCompare(b.name))

  const assessments: Assessment[] = ((examRows ?? []) as unknown as {
    id: string; title: string; type: string; lesson_id: string | null; created_at: string; ends_at: string | null
    questions: unknown; group_id: string | null; lessons: { title: string } | null
  }[]).map(e => ({
    id: e.id, kind: e.type === 'homework' ? 'homework' : 'exam', title: e.title, lessonId: e.lesson_id,
    lessonTitle: e.lessons?.title ?? null, createdAt: e.created_at, endsAt: e.ends_at,
    maxPoints: pointsOf(e.questions), source: e.group_id ? 'group' : 'course',
  }))

  const examIds = assessments.map(a => a.id)
  const memberIds = members.map(m => m.studentId)
  const sessions = ((sessionRows ?? []) as { id: string; session_date: string; title: string | null }[])
    .map(s => ({ id: s.id, date: s.session_date, title: s.title }))

  const [subsRes, marksRes, progress] = await Promise.all([
    examIds.length && memberIds.length
      ? supabase.from('exam_submissions')
          .select('id, exam_id, student_id, score, max_score, grading_status, status, submitted_at, is_flagged')
          .in('exam_id', examIds).in('student_id', memberIds)
      : Promise.resolve({ data: [] }),
    sessions.length
      ? supabase.from('attendance_records')
          .select('session_id, student_id, status, note, attendance_sessions!inner(group_id)')
          .eq('attendance_sessions.group_id', group.id)
      : Promise.resolve({ data: [] }),
    group.courseId && group.courseTitle && memberIds.length ? loadCourseProgress(supabase, group.courseId, memberIds) : Promise.resolve(null),
  ])

  const submissions: Submission[] = ((subsRes.data ?? []) as {
    id: string; exam_id: string; student_id: string; score: number | null; max_score: number | null
    grading_status: Submission['gradingStatus'] | null; status: Submission['status'] | null; submitted_at: string | null; is_flagged: boolean | null
  }[]).map(s => ({
    id: s.id, examId: s.exam_id, studentId: s.student_id,
    score: s.score == null ? null : Number(s.score), maxScore: s.max_score == null ? null : Number(s.max_score),
    gradingStatus: s.grading_status ?? 'pending', status: s.status ?? 'submitted',
    submittedAt: s.submitted_at, flagged: !!s.is_flagged,
  }))

  const marks = ((marksRes.data ?? []) as { session_id: string; student_id: string; status: AttendanceStatus; note: string | null }[])
    .map(m => ({ sessionId: m.session_id, studentId: m.student_id, status: m.status, note: m.note }))

  return { group, members, assessments, submissions, sessions, marks, progress }
}

async function loadCourseProgress(supabase: SupabaseClient, courseId: string, studentIds: string[]) {
  const [{ count }, { data }] = await Promise.all([
    supabase.from('unit_items').select('id', { count: 'exact', head: true }).eq('course_id', courseId).eq('is_published', true),
    supabase.from('student_progress')
      .select('student_id, unit_items!inner(course_id, is_published)')
      .eq('unit_items.course_id', courseId).eq('unit_items.is_published', true)
      .in('student_id', studentIds),
  ])
  const done = new Map<string, number>()
  for (const p of (data ?? []) as { student_id: string }[]) done.set(p.student_id, (done.get(p.student_id) ?? 0) + 1)
  return { total: count ?? 0, done }
}

/** One student's marks across the group's sessions (unmarked sessions included). */
export function marksFor(data: GroupData, studentId: string): AttendanceMark[] {
  const mine = new Map(data.marks.filter(m => m.studentId === studentId).map(m => [m.sessionId, m]))
  return data.sessions.map(s => {
    const m = mine.get(s.id)
    return { sessionId: s.id, date: s.date, title: s.title, status: m?.status ?? null, note: m?.note ?? null }
  })
}

export function progressFor(data: GroupData, studentId: string) {
  return data.progress ? { done: data.progress.done.get(studentId) ?? 0, total: data.progress.total } : null
}

/** A row per student of the group, for the group page's table. */
export function groupStudentRows(data: GroupData, now: number) {
  return data.members.map(m => {
    const items = buildItems(data.assessments, data.submissions.filter(s => s.studentId === m.studentId), m.joinedAt, now)
    return { member: m, summary: summarize(items, marksFor(data, m.studentId), progressFor(data, m.studentId)) }
  })
}

// ── Groups overview ─────────────────────────────────────────────────────────

export interface GroupCard {
  group: GroupInfo
  students: number
  exams: number
  homework: number
  /** Average grade of the group's graded submissions. */
  avg: number | null
  attendanceRate: number | null
  atRisk: number
}

/** Every group the teacher owns, with headline numbers. */
export async function loadGroupCards(supabase: SupabaseClient, teacherId: string, now: number): Promise<GroupCard[]> {
  const { data: rows } = await supabase
    .from('groups').select(GROUP_COLUMNS).eq('teacher_id', teacherId).order('created_at', { ascending: false })
  const groups = ((rows ?? []) as unknown as GroupRow[]).map(toGroupInfo)
  // Per-group data sets are small (one class each), so reusing the group loader
  // keeps the numbers on the card identical to the ones inside the group.
  const all = await Promise.all(groups.map(g => loadGroupData(supabase, teacherId, g.id)))
  return all.flatMap(d => {
    if (!d) return []
    const students = groupStudentRows(d, now)
    const graded = students.flatMap(s => (s.summary.overallAvg == null ? [] : [s.summary.overallAvg]))
    const att = summarizeAttendance(d.marks.map(m => ({ sessionId: m.sessionId, date: '', title: null, status: m.status, note: null })))
    return [{
      group: d.group,
      students: d.members.length,
      exams: d.assessments.filter(a => a.kind === 'exam').length,
      homework: d.assessments.filter(a => a.kind === 'homework').length,
      avg: graded.length ? Math.round(graded.reduce((a, x) => a + x, 0) / graded.length) : null,
      attendanceRate: att.rate,
      atRisk: students.filter(s => s.summary.atRisk).length,
    }]
  })
}
