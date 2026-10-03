// ── Teacher records: groups → students → one student's full record ──────────
//
// The reads live in src/lib/data/teacher-records.ts (the teacher's own data,
// through the teacher's session). The pure functions below turn rows into a
// student's record. They take `now` as an argument so the same inputs always
// give the same record.

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
  /** Individual follow-up task: the one student it was sent to (null = the whole roster). */
  assignedTo?: string | null
  /** false = feedback/practice only: shown with its status, never in an average. */
  countsTowardGrade?: boolean
  /** The exam an individual task follows up, when there is one. */
  sourceExamId?: string | null
}

/** Work set for everyone, as opposed to one student's individual task. */
export const isShared = (a: Assessment) => !a.assignedTo

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
 * student joined does not apply to them and is left out, and so is another
 * student's individual task. A feedback-only task keeps its status but never
 * gets a percentage, so it stays out of every average.
 */
export function buildItems(
  assessments: Assessment[], subs: Submission[], joinedAt: string | null, now: number, studentId?: string,
): RecordItem[] {
  const byExam = new Map(subs.map(s => [s.examId, s]))
  const joined = joinedAt ? new Date(joinedAt).getTime() : null
  return assessments
    .filter(a => !a.assignedTo || a.assignedTo === studentId)
    .filter(a => !(joined && a.endsAt && new Date(a.endsAt).getTime() < joined && !byExam.has(a.id)))
    .map(a => {
      const s = byExam.get(a.id) ?? null
      const max = s?.maxScore ?? (a.maxPoints || null)
      let status: ItemStatus
      if (s && s.status === 'submitted') status = s.score != null ? 'graded' : 'awaiting'
      else if (s) status = 'inProgress'
      else status = a.endsAt && new Date(a.endsAt).getTime() < now ? 'missed' : 'open'
      const score = status === 'graded' ? s!.score : null
      const pct = score != null && max && a.countsTowardGrade !== false ? Math.round((score / max) * 100) : null
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

// ── Group data (read by src/lib/data/teacher-records.ts) ────────────────────

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
    const items = buildItems(data.assessments, data.submissions.filter(s => s.studentId === m.studentId), m.joinedAt, now, m.studentId)
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
