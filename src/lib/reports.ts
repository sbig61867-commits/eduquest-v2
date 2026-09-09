import { createClient as createAdminClient, SupabaseClient } from '@supabase/supabase-js'

// ── Generic report shape ──────────────────────────────────────────
// Every report is a list of sections; each section is a titled table.
// This single shape renders to an HTML/print view AND serializes to CSV,
// so all report types share one rendering + export path.
export interface ReportTable {
  heading: string
  columns: string[]
  rows: (string | number)[][]
}
export interface Report {
  title: string
  subtitle: string
  /** Tenant (university) the subject belongs to — shown under the title. */
  university?: string
  generatedAt: string
  lang: ReportLang
  tables: ReportTable[]
}

export type ReportScope = 'university' | 'teacher' | 'group' | 'student' | 'pilot'
export type ReportLang = 'ar' | 'en'

export interface CallerProfile { role: string; tenant_id: string | null }

// ── Authorization (future-ready) ──────────────────────────────────
export function canAccessReport(profile: CallerProfile): { ok: boolean; reason?: string } {
  if (profile.role === 'super_admin') return { ok: true }
  return { ok: false, reason: 'Reports are currently restricted to the platform owner.' }
}

export function reportsAdminClient(): SupabaseClient {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// ── Bilingual strings ─────────────────────────────────────────────
// Server-side dictionary: every heading/column/status the builders emit.
const STR = {
  ar: {
    universityReport: 'تقرير جامعة', teacherReport: 'تقرير معلم', groupReport: 'تقرير مجموعة', studentReport: 'تقرير طالب',
    uTeacher: 'معلم', uStudent: 'طالب', uGroup: 'مجموعة', uAssessment: 'تقييم', uAssessmentDue: 'تقييم مستحق',
    execSummary: 'الملخص التنفيذي',
    teachers: 'المعلمون', students: 'الطلاب', groups: 'المجموعات', assessments: 'التقييمات',
    lessonsPublished: 'الدروس المنشورة', submissions: 'التسليمات', avgOverall: 'متوسط الأداء العام',
    teacher: 'المعلم', email: 'البريد', avgTheirStudents: 'متوسط أداء طلابه',
    group: 'المجموعة', avgPerf: 'متوسط الأداء',
    distribution: 'توزيع الدرجات', bucket: 'الشريحة', subCount: 'عدد التسليمات', pctOfGraded: 'النسبة من المصحح',
    bExcellent: 'ممتاز (90–100%)', bVGood: 'جيد جداً (80–89%)', bGood: 'جيد (70–79%)', bPass: 'مقبول (50–69%)', bWeak: 'ضعيف (أقل من 50%)',
    activity30: 'النشاط (آخر 30 يوماً)', newExams: 'تقييمات جديدة', studentSubs: 'تسليمات الطلاب',
    integrityUni: 'نزاهة الاختبارات (تسليمات عليها مخالفات)', exam: 'الاختبار', flaggedSubs: 'تسليمات مخالِفة',
    summary: 'الملخص', submissionRate: 'نسبة التسليم',
    assessmentsDetail: 'تفصيل التقييمات', assessment: 'التقييم', type: 'النوع', submittedOf: 'سلّم / المطلوب',
    avg: 'المتوسط', highest: 'الأعلى', lowest: 'الأدنى', pendingGrading: 'بانتظار تصحيح',
    struggling: 'طلاب متعثرون (أقل من 50%)', student: 'الطالب',
    pendingTable: 'تسليمات بانتظار التصحيح', ungradedCount: 'عدد غير المصحح',
    studentGrades: 'درجات الطلاب', total: 'المجموع', pctCol: 'النسبة %',
    homeworkTag: '[واجب] ', homework: 'واجب', examType: 'اختبار',
    card: 'بطاقة الطالب', name: 'الاسم', joinDate: 'تاريخ الانضمام',
    gradeSheet: 'كشف الدرجات', grade: 'الدرجة', pct: 'النسبة', submitDate: 'تاريخ التسليم', status: 'الحالة',
    notSubmitted: 'لم يسلّم', awaitingGrading: 'بانتظار التصحيح', graded: 'مصحح',
    overallSummary: 'الملخص العام', totalScores: 'مجموع الدرجات', gpa: 'المعدل العام',
    peersAvg: 'متوسط المجموعات', position: 'الموقع', above: 'فوق المتوسط', below: 'تحت المتوسط',
    missing: 'تقييمات لم تُسلَّم', createdAt: 'تاريخ الإنشاء',
    trend: 'الاتجاه الزمني', firstHalf: 'النصف الأول', secondHalf: 'النصف الأخير',
    trendCol: 'التقييم', improved: 'تحسّن ↑', declined: 'تراجع ↓', stable: 'ثابت',
    integrity: 'نزاهة الاختبارات', flaggedOf: 'تسليمات عليها مخالفات', outOf: 'من أصل',
    teacherPrefix: 'المعلم',
    pilotReport: 'تقرير تجربة', execSummaryPilot: 'ملخص التجربة',
    weeklyActivity: 'النشاط الأسبوعي', week: 'الأسبوع', weekNewAssessments: 'تقييمات جديدة', weekSubmissions: 'تسليمات',
    hoursSaved: 'ساعات التصحيح الموفَّرة (تقديرية)',
    proctoredExams: 'اختبارات مراقَبة',
    studentFeedback: 'رأي الطلاب', respondents: 'عدد المجيبين', avgEase: 'متوسط سهولة الاستخدام (من 5)',
    prefersPlatform: 'يفضلون المنصة', wouldRecommend: 'ينصحون بها',
    quotes: 'اقتباسات الطلاب', quoteFeature: 'أفضل ميزة', quoteProblem: 'مشكلة واجهها', quoteComment: 'تعليق',
    noResponses: 'لا توجد إجابات بعد',
  },
  en: {
    universityReport: 'University Report', teacherReport: 'Teacher Report', groupReport: 'Group Report', studentReport: 'Student Report',
    uTeacher: 'teacher(s)', uStudent: 'student(s)', uGroup: 'group(s)', uAssessment: 'assessment(s)', uAssessmentDue: 'assessment(s) due',
    execSummary: 'Executive Summary',
    teachers: 'Teachers', students: 'Students', groups: 'Groups', assessments: 'Assessments',
    lessonsPublished: 'Published Lessons', submissions: 'Submissions', avgOverall: 'Overall Average',
    teacher: 'Teacher', email: 'Email', avgTheirStudents: 'Students\' Average',
    group: 'Group', avgPerf: 'Average Performance',
    distribution: 'Grade Distribution', bucket: 'Band', subCount: 'Submissions', pctOfGraded: '% of Graded',
    bExcellent: 'Excellent (90–100%)', bVGood: 'Very Good (80–89%)', bGood: 'Good (70–79%)', bPass: 'Pass (50–69%)', bWeak: 'Weak (below 50%)',
    activity30: 'Activity (Last 30 Days)', newExams: 'New Assessments', studentSubs: 'Student Submissions',
    integrityUni: 'Exam Integrity (Flagged Submissions)', exam: 'Exam', flaggedSubs: 'Flagged Submissions',
    summary: 'Summary', submissionRate: 'Submission Rate',
    assessmentsDetail: 'Assessment Details', assessment: 'Assessment', type: 'Type', submittedOf: 'Submitted / Expected',
    avg: 'Average', highest: 'Highest', lowest: 'Lowest', pendingGrading: 'Pending Grading',
    struggling: 'Struggling Students (below 50%)', student: 'Student',
    pendingTable: 'Submissions Awaiting Grading', ungradedCount: 'Ungraded Count',
    studentGrades: 'Student Grades', total: 'Total', pctCol: 'Percentage %',
    homeworkTag: '[HW] ', homework: 'Homework', examType: 'Exam',
    card: 'Student Card', name: 'Name', joinDate: 'Joined',
    gradeSheet: 'Grade Sheet', grade: 'Score', pct: 'Percentage', submitDate: 'Submitted On', status: 'Status',
    notSubmitted: 'Not submitted', awaitingGrading: 'Awaiting grading', graded: 'Graded',
    overallSummary: 'Overall Summary', totalScores: 'Total Score', gpa: 'Overall Average',
    peersAvg: 'Peer Average', position: 'Standing', above: 'Above average', below: 'Below average',
    missing: 'Assessments Not Submitted', createdAt: 'Created On',
    trend: 'Performance Trend', firstHalf: 'First Half', secondHalf: 'Second Half',
    trendCol: 'Assessment', improved: 'Improved ↑', declined: 'Declined ↓', stable: 'Stable',
    integrity: 'Exam Integrity', flaggedOf: 'Flagged Submissions', outOf: 'Out Of',
    teacherPrefix: 'Teacher',
    pilotReport: 'Pilot Report', execSummaryPilot: 'Pilot Summary',
    weeklyActivity: 'Weekly Activity', week: 'Week', weekNewAssessments: 'New Assessments', weekSubmissions: 'Submissions',
    hoursSaved: 'Grading Hours Saved (estimated)',
    proctoredExams: 'Proctored Exams',
    studentFeedback: 'Student Feedback', respondents: 'Respondents', avgEase: 'Avg. Ease of Use (out of 5)',
    prefersPlatform: 'Prefer the Platform', wouldRecommend: 'Would Recommend',
    quotes: 'Student Quotes', quoteFeature: 'Best Feature', quoteProblem: 'Problem Faced', quoteComment: 'Comment',
    noResponses: 'No responses yet',
  },
} as const
type Dict = { [K in keyof typeof STR.ar]: string }

// ── Shared row shapes (batched queries, computed in memory) ───────
interface ExamRow {
  id: string; title: string; type: string; group_id: string; teacher_id: string
  questions: unknown; created_at: string; proctoring_enabled: boolean; is_published: boolean
}
interface SubRow {
  exam_id: string; student_id: string; score: number | null; max_score: number | null
  is_graded: boolean; is_flagged: boolean; submitted_at: string | null
}

// ── Helpers ───────────────────────────────────────────────────────
function examMax(questions: unknown): number {
  if (!Array.isArray(questions)) return 0
  return (questions as Array<{ points?: number }>).reduce((s, q) => s + (q.points ?? 0), 0)
}
const pct = (score: number, max: number) => (max > 0 ? Math.round((score / max) * 100) : 0)
const fmtDate = (iso: string | null, lang: ReportLang) =>
  iso ? new Date(iso).toLocaleDateString(lang === 'ar' ? 'ar' : 'en-GB') : '·'
const typeLabel = (t: string, d: Dict) => (t === 'homework' ? d.homework : d.examType)

function sumScores(subs: SubRow[], maxByExam: Map<string, number>) {
  let total = 0, totalMax = 0
  for (const s of subs) {
    if (s.score == null) continue
    total += Number(s.score)
    totalMax += s.max_score != null ? Number(s.max_score) : (maxByExam.get(s.exam_id) ?? 0)
  }
  return { total, totalMax }
}

function distributionTable(subs: SubRow[], maxByExam: Map<string, number>, d: Dict): ReportTable {
  const buckets = [
    { label: d.bExcellent, min: 90, count: 0 },
    { label: d.bVGood, min: 80, count: 0 },
    { label: d.bGood, min: 70, count: 0 },
    { label: d.bPass, min: 50, count: 0 },
    { label: d.bWeak, min: 0, count: 0 },
  ]
  let graded = 0
  for (const s of subs) {
    if (s.score == null) continue
    const max = s.max_score != null ? Number(s.max_score) : (maxByExam.get(s.exam_id) ?? 0)
    if (max <= 0) continue
    graded++
    const p = (Number(s.score) / max) * 100
    for (const b of buckets) { if (p >= b.min) { b.count++; break } }
  }
  return {
    heading: d.distribution,
    columns: [d.bucket, d.subCount, d.pctOfGraded],
    rows: buckets.map(b => [b.label, b.count, graded ? `${Math.round((b.count / graded) * 100)}%` : '·']),
  }
}

// ══════════════════════════════════════════════════════════════════
// University report
// ══════════════════════════════════════════════════════════════════
export async function buildUniversityReport(admin: SupabaseClient, tenantId: string, lang: ReportLang = 'ar'): Promise<Report | null> {
  const d = STR[lang]
  const { data: tenant } = await admin.from('tenants').select('id, name').eq('id', tenantId).single()
  if (!tenant) return null

  const [{ data: people }, { data: groups }, { data: exams }, { count: lessonCount }, { data: subs }] = await Promise.all([
    admin.from('users').select('id, full_name, email, role').eq('tenant_id', tenantId).in('role', ['teacher', 'student']),
    admin.from('groups').select('id, name, teacher_id').eq('tenant_id', tenantId).is('deleted_at', null),
    admin.from('exams').select('id, title, type, group_id, teacher_id, questions, created_at, proctoring_enabled, is_published').eq('tenant_id', tenantId).is('deleted_at', null),
    admin.from('lessons').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('is_published', true).is('deleted_at', null),
    admin.from('exam_submissions').select('exam_id, student_id, score, max_score, is_graded, is_flagged, submitted_at').eq('tenant_id', tenantId),
  ])

  const teachers = (people ?? []).filter(p => p.role === 'teacher')
  const students = (people ?? []).filter(p => p.role === 'student')
  const examRows = (exams ?? []) as ExamRow[]
  const subRows = (subs ?? []) as SubRow[]
  const maxByExam = new Map(examRows.map(e => [e.id, examMax(e.questions)]))

  const groupIds = (groups ?? []).map(g => g.id)
  const { data: memberships } = groupIds.length
    ? await admin.from('group_students').select('group_id, student_id').in('group_id', groupIds)
    : { data: [] as Array<{ group_id: string; student_id: string }> }
  const membersByGroup = new Map<string, number>()
  for (const m of memberships ?? []) membersByGroup.set(m.group_id, (membersByGroup.get(m.group_id) ?? 0) + 1)

  const teacherName = new Map(teachers.map(t => [t.id, t.full_name]))
  const overall = sumScores(subRows, maxByExam)

  const summary: ReportTable = {
    heading: d.execSummary,
    columns: [d.teachers, d.students, d.groups, d.assessments, d.lessonsPublished, d.submissions, d.avgOverall],
    rows: [[teachers.length, students.length, (groups ?? []).length, examRows.length, lessonCount ?? 0, subRows.length,
      overall.totalMax ? `${pct(overall.total, overall.totalMax)}%` : '·']],
  }

  const teacherTable: ReportTable = {
    heading: d.teachers,
    columns: [d.teacher, d.email, d.groups, d.students, d.assessments, d.avgTheirStudents],
    rows: teachers.map(t => {
      const tGroups = (groups ?? []).filter(g => g.teacher_id === t.id)
      const tStudents = tGroups.reduce((s, g) => s + (membersByGroup.get(g.id) ?? 0), 0)
      const tExamIds = new Set(examRows.filter(e => e.teacher_id === t.id).map(e => e.id))
      const tSubs = subRows.filter(s => tExamIds.has(s.exam_id))
      const agg = sumScores(tSubs, maxByExam)
      return [t.full_name, t.email, tGroups.length, tStudents, tExamIds.size,
        agg.totalMax ? `${pct(agg.total, agg.totalMax)}%` : '·']
    }),
  }

  const groupTable: ReportTable = {
    heading: d.groups,
    columns: [d.group, d.teacher, d.students, d.assessments, d.avgPerf],
    rows: (groups ?? []).map(g => {
      const gExamIds = new Set(examRows.filter(e => e.group_id === g.id).map(e => e.id))
      const gSubs = subRows.filter(s => gExamIds.has(s.exam_id))
      const agg = sumScores(gSubs, maxByExam)
      return [g.name, teacherName.get(g.teacher_id) ?? '·', membersByGroup.get(g.id) ?? 0, gExamIds.size,
        agg.totalMax ? `${pct(agg.total, agg.totalMax)}%` : '·']
    }),
  }

  const distribution = distributionTable(subRows, maxByExam, d)

  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
  const recentExams = examRows.filter(e => new Date(e.created_at).getTime() >= cutoff).length
  const recentSubs = subRows.filter(s => s.submitted_at && new Date(s.submitted_at).getTime() >= cutoff).length
  const activity: ReportTable = {
    heading: d.activity30,
    columns: [d.newExams, d.studentSubs],
    rows: [[recentExams, recentSubs]],
  }

  const flaggedByExam = new Map<string, number>()
  for (const s of subRows) if (s.is_flagged) flaggedByExam.set(s.exam_id, (flaggedByExam.get(s.exam_id) ?? 0) + 1)
  const integrity: ReportTable = {
    heading: d.integrityUni,
    columns: [d.exam, d.teacher, d.flaggedSubs],
    rows: [...flaggedByExam.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([examId, n]) => {
        const e = examRows.find(x => x.id === examId)
        return [e?.title ?? '·', teacherName.get(e?.teacher_id ?? '') ?? '·', n]
      }),
  }

  return {
    title: `${d.universityReport}: ${tenant.name}`,
    subtitle: `${teachers.length} ${d.uTeacher} · ${students.length} ${d.uStudent} · ${(groups ?? []).length} ${d.uGroup}`,
    generatedAt: new Date().toISOString(),
    lang,
    tables: [summary, teacherTable, groupTable, distribution, activity, integrity],
  }
}

// ══════════════════════════════════════════════════════════════════
// Teacher report
// ══════════════════════════════════════════════════════════════════
export async function buildTeacherReport(admin: SupabaseClient, teacherId: string, lang: ReportLang = 'ar'): Promise<Report | null> {
  const d = STR[lang]
  const { data: teacher } = await admin.from('users').select('id, full_name, email, tenant_id, tenants(name)').eq('id', teacherId).single()
  if (!teacher) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const universityName = ((teacher as any).tenants?.name as string | undefined) ?? undefined

  const [{ data: groups }, { data: exams }, { count: lessonCount }] = await Promise.all([
    admin.from('groups').select('id, name').eq('teacher_id', teacherId).is('deleted_at', null).order('created_at', { ascending: true }),
    admin.from('exams').select('id, title, type, group_id, teacher_id, questions, created_at, proctoring_enabled, is_published').eq('teacher_id', teacherId).is('deleted_at', null).order('created_at', { ascending: true }),
    admin.from('lessons').select('id', { count: 'exact', head: true }).eq('teacher_id', teacherId).eq('is_published', true).is('deleted_at', null),
  ])
  const examRows = (exams ?? []) as ExamRow[]
  const groupIds = (groups ?? []).map(g => g.id)
  const examIds = examRows.map(e => e.id)

  const [{ data: memberships }, { data: subs }] = await Promise.all([
    groupIds.length
      ? admin.from('group_students').select('group_id, student_id, users(full_name, email)').in('group_id', groupIds)
      : Promise.resolve({ data: [] }),
    examIds.length
      ? admin.from('exam_submissions').select('exam_id, student_id, score, max_score, is_graded, is_flagged, submitted_at').in('exam_id', examIds)
      : Promise.resolve({ data: [] }),
  ])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const memberRows = (memberships ?? []) as any[]
  const subRows = (subs ?? []) as SubRow[]
  const maxByExam = new Map(examRows.map(e => [e.id, examMax(e.questions)]))
  const groupName = new Map((groups ?? []).map(g => [g.id, g.name]))
  const membersByGroup = new Map<string, string[]>()
  for (const m of memberRows) {
    const arr = membersByGroup.get(m.group_id) ?? []
    arr.push(m.student_id)
    membersByGroup.set(m.group_id, arr)
  }

  const totalStudents = new Set(memberRows.map(m => m.student_id)).size
  const overall = sumScores(subRows, maxByExam)
  const summary: ReportTable = {
    heading: d.summary,
    columns: [d.groups, d.students, d.lessonsPublished, d.assessments, d.avgTheirStudents],
    rows: [[(groups ?? []).length, totalStudents, lessonCount ?? 0, examRows.length,
      overall.totalMax ? `${pct(overall.total, overall.totalMax)}%` : '·']],
  }

  const groupTable: ReportTable = {
    heading: d.groups,
    columns: [d.group, d.students, d.assessments, d.submissionRate, d.avgPerf],
    rows: (groups ?? []).map(g => {
      const gMembers = membersByGroup.get(g.id) ?? []
      const gExams = examRows.filter(e => e.group_id === g.id)
      const gExamIds = new Set(gExams.map(e => e.id))
      const gSubs = subRows.filter(s => gExamIds.has(s.exam_id))
      const expected = gMembers.length * gExams.length
      const agg = sumScores(gSubs, maxByExam)
      return [g.name, gMembers.length, gExams.length,
        expected ? `${Math.round((gSubs.length / expected) * 100)}%` : '·',
        agg.totalMax ? `${pct(agg.total, agg.totalMax)}%` : '·']
    }),
  }

  const assessmentTable: ReportTable = {
    heading: d.assessmentsDetail,
    columns: [d.assessment, d.type, d.group, d.submittedOf, d.avg, d.highest, d.lowest, d.pendingGrading],
    rows: examRows.map(e => {
      const eSubs = subRows.filter(s => s.exam_id === e.id)
      const graded = eSubs.filter(s => s.score != null)
      const max = maxByExam.get(e.id) ?? 0
      const pcts = graded.map(s => pct(Number(s.score), s.max_score != null ? Number(s.max_score) : max))
      const expected = (membersByGroup.get(e.group_id) ?? []).length
      return [e.title, typeLabel(e.type, d), groupName.get(e.group_id) ?? '·',
        `${eSubs.length} / ${expected}`,
        pcts.length ? `${Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length)}%` : '·',
        pcts.length ? `${Math.max(...pcts)}%` : '·',
        pcts.length ? `${Math.min(...pcts)}%` : '·',
        eSubs.filter(s => !s.is_graded).length]
    }),
  }

  const byStudent = new Map<string, SubRow[]>()
  for (const s of subRows) {
    const arr = byStudent.get(s.student_id) ?? []
    arr.push(s)
    byStudent.set(s.student_id, arr)
  }
  const studentInfo = new Map(memberRows.map(m => [m.student_id, m.users]))
  const strugglingRows: (string | number)[][] = []
  for (const [studentId, sSubs] of byStudent) {
    const agg = sumScores(sSubs, maxByExam)
    if (agg.totalMax > 0 && pct(agg.total, agg.totalMax) < 50) {
      const info = studentInfo.get(studentId)
      strugglingRows.push([info?.full_name ?? '·', info?.email ?? '·', `${pct(agg.total, agg.totalMax)}%`, sSubs.length])
    }
  }
  const struggling: ReportTable = {
    heading: d.struggling,
    columns: [d.student, d.email, d.avg, d.subCount],
    rows: strugglingRows.sort((a, b) => parseInt(String(a[2])) - parseInt(String(b[2]))),
  }

  const pendingRows = examRows
    .map(e => ({ e, pending: subRows.filter(s => s.exam_id === e.id && !s.is_graded).length }))
    .filter(x => x.pending > 0)
    .map(x => [x.e.title, groupName.get(x.e.group_id) ?? '·', x.pending] as (string | number)[])
  const discipline: ReportTable = {
    heading: d.pendingTable,
    columns: [d.assessment, d.group, d.ungradedCount],
    rows: pendingRows,
  }

  return {
    title: `${d.teacherReport}: ${teacher.full_name}`,
    subtitle: `${teacher.email} · ${(groups ?? []).length} ${d.uGroup} · ${totalStudents} ${d.uStudent}`,
    university: universityName,
    generatedAt: new Date().toISOString(),
    lang,
    tables: [summary, groupTable, assessmentTable, struggling, discipline],
  }
}

// ══════════════════════════════════════════════════════════════════
// Group report
// ══════════════════════════════════════════════════════════════════
export async function buildGroupReport(admin: SupabaseClient, groupId: string, lang: ReportLang = 'ar'): Promise<Report | null> {
  const d = STR[lang]
  const { data: group } = await admin
    .from('groups').select('id, name, tenant_id, users:teacher_id(full_name), tenants(name)').eq('id', groupId).single()
  if (!group) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const universityName = ((group as any).tenants?.name as string | undefined) ?? undefined

  const [{ data: exams }, { data: members }] = await Promise.all([
    admin.from('exams').select('id, title, type, questions').eq('group_id', groupId).is('deleted_at', null).order('created_at', { ascending: true }),
    admin.from('group_students').select('student_id, users(full_name, email)').eq('group_id', groupId),
  ])
  const examIds = (exams ?? []).map(e => e.id)
  const { data: subs } = examIds.length
    ? await admin.from('exam_submissions').select('exam_id, student_id, score').in('exam_id', examIds)
    : { data: [] as Array<{ exam_id: string; student_id: string; score: number | null }> }

  const columns = [d.student, d.email, ...(exams ?? []).map(e => `${e.type === 'homework' ? d.homeworkTag : ''}${e.title}`), d.total, d.pctCol]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (members as any[] ?? []).map((m: any) => {
    let total = 0, totalMax = 0
    const cells = (exams ?? []).map(e => {
      const sub = (subs ?? []).find(s => s.exam_id === e.id && s.student_id === m.student_id)
      const max = examMax(e.questions)
      if (sub?.score != null) { total += Number(sub.score); totalMax += max; return `${sub.score}/${max}` }
      return '·'
    })
    return [m.users?.full_name ?? '·', m.users?.email ?? '', ...cells, totalMax ? `${total}/${totalMax}` : '·', totalMax ? String(pct(total, totalMax)) : '·']
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const teacherName = (group as any).users?.full_name ?? '·'
  return {
    title: `${d.groupReport}: ${group.name}`,
    subtitle: `${d.teacherPrefix}: ${teacherName} · ${(members ?? []).length} ${d.uStudent} · ${(exams ?? []).length} ${d.uAssessment}`,
    university: universityName,
    generatedAt: new Date().toISOString(),
    lang,
    tables: [{ heading: d.studentGrades, columns, rows }],
  }
}

// ══════════════════════════════════════════════════════════════════
// Pilot report — everything measurable for a trial period on one group:
// exec summary (incl. estimated grading hours saved), weekly activity,
// grade matrix + distribution, exam integrity, and student survey results.
// ══════════════════════════════════════════════════════════════════
const MINUTES_SAVED_PER_AUTO_GRADED = 5

export async function buildPilotReport(admin: SupabaseClient, groupId: string, lang: ReportLang = 'ar'): Promise<Report | null> {
  const d = STR[lang]
  const { data: group } = await admin
    .from('groups').select('id, name, tenant_id, created_at, users:teacher_id(full_name), tenants(name)').eq('id', groupId).single()
  if (!group) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const universityName = ((group as any).tenants?.name as string | undefined) ?? undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const teacherName = (group as any).users?.full_name ?? '·'

  const [{ data: exams }, { data: members }, { count: lessonCount }, { data: survey }] = await Promise.all([
    admin.from('exams').select('id, title, type, group_id, teacher_id, questions, created_at, proctoring_enabled, is_published').eq('group_id', groupId).is('deleted_at', null).order('created_at', { ascending: true }),
    admin.from('group_students').select('student_id, users(full_name, email)').eq('group_id', groupId),
    admin.from('lessons').select('id', { count: 'exact', head: true }).eq('group_id', groupId).eq('is_published', true).is('deleted_at', null),
    admin.from('surveys').select('id, title').eq('group_id', groupId).maybeSingle(),
  ])
  const examRows = (exams ?? []) as ExamRow[]
  const examIds = examRows.map(e => e.id)
  const maxByExam = new Map(examRows.map(e => [e.id, examMax(e.questions)]))

  const { data: subs } = examIds.length
    ? await admin.from('exam_submissions').select('exam_id, student_id, score, max_score, is_graded, is_flagged, submitted_at').in('exam_id', examIds)
    : { data: [] as SubRow[] }
  const subRows = (subs ?? []) as SubRow[]
  const overall = sumScores(subRows, maxByExam)

  // 1. Executive summary
  const autoGraded = subRows.filter(s => s.is_graded).length
  const hoursSaved = Math.round((autoGraded * MINUTES_SAVED_PER_AUTO_GRADED / 60) * 10) / 10
  const expected = (members ?? []).length * examRows.length
  const summary: ReportTable = {
    heading: d.execSummaryPilot,
    columns: [d.students, d.lessonsPublished, d.assessments, d.submissions, d.submissionRate, d.avgOverall, d.hoursSaved],
    rows: [[(members ?? []).length, lessonCount ?? 0, examRows.length, subRows.length,
      expected ? `${Math.round((subRows.length / expected) * 100)}%` : '·',
      overall.totalMax ? `${pct(overall.total, overall.totalMax)}%` : '·',
      hoursSaved]],
  }

  // 2. Weekly activity since group creation
  const startTime = new Date(group.created_at).getTime()
  const weekMs = 7 * 24 * 60 * 60 * 1000
  const weekCount = Math.max(1, Math.ceil((Date.now() - startTime) / weekMs))
  const weeklyRows: (string | number)[][] = []
  for (let w = 0; w < weekCount; w++) {
    const from = startTime + w * weekMs, to = from + weekMs
    const newExams = examRows.filter(e => { const t = new Date(e.created_at).getTime(); return t >= from && t < to }).length
    const weekSubs = subRows.filter(s => s.submitted_at && (() => { const t = new Date(s.submitted_at!).getTime(); return t >= from && t < to })()).length
    weeklyRows.push([`${d.week} ${w + 1}`, newExams, weekSubs])
  }
  const weekly: ReportTable = { heading: d.weeklyActivity, columns: [d.week, d.weekNewAssessments, d.weekSubmissions], rows: weeklyRows }

  // 3. Grade matrix (per-student, per-assessment) — same shape as group report
  const gradeColumns = [d.student, d.email, ...examRows.map(e => `${e.type === 'homework' ? d.homeworkTag : ''}${e.title}`), d.total, d.pctCol]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gradeRows = (members as any[] ?? []).map((m: any) => {
    let total = 0, totalMax = 0
    const cells = examRows.map(e => {
      const sub = subRows.find(s => s.exam_id === e.id && s.student_id === m.student_id)
      const max = maxByExam.get(e.id) ?? 0
      if (sub?.score != null) { total += Number(sub.score); totalMax += max; return `${sub.score}/${max}` }
      return '·'
    })
    return [m.users?.full_name ?? '·', m.users?.email ?? '', ...cells, totalMax ? `${total}/${totalMax}` : '·', totalMax ? String(pct(total, totalMax)) : '·']
  })
  const gradeMatrix: ReportTable = { heading: d.studentGrades, columns: gradeColumns, rows: gradeRows }

  const distribution = distributionTable(subRows, maxByExam, d)

  // 4. Integrity
  const proctoredCount = examRows.filter(e => e.proctoring_enabled).length
  const flaggedCount = subRows.filter(s => s.is_flagged).length
  const integrity: ReportTable = {
    heading: d.integrity,
    columns: [d.proctoredExams, d.flaggedOf, d.outOf],
    rows: [[proctoredCount, flaggedCount, subRows.length]],
  }

  // 5. Student feedback (survey)
  let feedbackRows: (string | number)[][] = [[0, '·', '·', '·']]
  const quoteRows: (string | number)[][] = []
  if (survey) {
    const { data: responses } = await admin
      .from('survey_responses')
      .select('ease_rating, prefer_platform, recommend, best_feature, problem_faced, comment')
      .eq('survey_id', survey.id)
    const r = responses ?? []
    if (r.length) {
      const avgEase = Math.round((r.reduce((s, x) => s + x.ease_rating, 0) / r.length) * 10) / 10
      const preferPct = Math.round((r.filter(x => x.prefer_platform).length / r.length) * 100)
      const recommendPct = Math.round((r.filter(x => x.recommend).length / r.length) * 100)
      feedbackRows = [[r.length, avgEase, `${preferPct}%`, `${recommendPct}%`]]
      for (const resp of r) {
        if (resp.best_feature || resp.problem_faced || resp.comment) {
          quoteRows.push([resp.best_feature || '·', resp.problem_faced || '·', resp.comment || '·'])
        }
      }
    }
  }
  const feedback: ReportTable = {
    heading: d.studentFeedback,
    columns: [d.respondents, d.avgEase, d.prefersPlatform, d.wouldRecommend],
    rows: feedbackRows,
  }
  const quotes: ReportTable = {
    heading: d.quotes,
    columns: [d.quoteFeature, d.quoteProblem, d.quoteComment],
    rows: quoteRows.slice(0, 10),
  }

  return {
    title: `${d.pilotReport}: ${group.name}`,
    subtitle: `${d.teacherPrefix}: ${teacherName} · ${(members ?? []).length} ${d.uStudent} · ${examRows.length} ${d.uAssessment}`,
    university: universityName,
    generatedAt: new Date().toISOString(),
    lang,
    tables: [summary, weekly, gradeMatrix, distribution, integrity, feedback, quotes],
  }
}

// ══════════════════════════════════════════════════════════════════
// Student report
// ══════════════════════════════════════════════════════════════════
export async function buildStudentReport(admin: SupabaseClient, studentId: string, lang: ReportLang = 'ar'): Promise<Report | null> {
  const d = STR[lang]
  const { data: student } = await admin
    .from('users').select('id, full_name, email, created_at, tenant_id, tenants(name)').eq('id', studentId).single()
  if (!student) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const universityName = ((student as any).tenants?.name as string | undefined) ?? undefined

  const { data: memberships } = await admin
    .from('group_students')
    .select('group_id, joined_at, groups(id, name, deleted_at, users:teacher_id(full_name))')
    .eq('student_id', studentId)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activeGroups = ((memberships ?? []) as any[]).filter(m => m.groups && !m.groups.deleted_at)
  const groupIds = activeGroups.map(m => m.group_id)

  const { data: exams } = groupIds.length
    ? await admin.from('exams')
        .select('id, title, type, group_id, teacher_id, questions, created_at, proctoring_enabled, is_published')
        .in('group_id', groupIds).eq('is_published', true).is('deleted_at', null)
        .order('created_at', { ascending: true })
    : { data: [] }
  const examRows = (exams ?? []) as ExamRow[]
  const examIds = examRows.map(e => e.id)

  const { data: subs } = examIds.length
    ? await admin.from('exam_submissions')
        .select('exam_id, student_id, score, max_score, is_graded, is_flagged, submitted_at')
        .eq('student_id', studentId).in('exam_id', examIds)
    : { data: [] }
  const subRows = (subs ?? []) as SubRow[]
  const subByExam = new Map(subRows.map(s => [s.exam_id, s]))
  const maxByExam = new Map(examRows.map(e => [e.id, examMax(e.questions)]))
  const groupName = new Map(activeGroups.map(m => [m.groups.id, m.groups.name]))

  const card: ReportTable = {
    heading: d.card,
    columns: [d.name, d.email, d.joinDate, d.groups],
    rows: [[student.full_name, student.email, fmtDate(student.created_at, lang),
      activeGroups.map(m => `${m.groups.name} (${m.groups.users?.full_name ?? '·'})`).join(lang === 'ar' ? '، ' : ', ') || '·']],
  }

  const gradeSheet: ReportTable = {
    heading: d.gradeSheet,
    columns: [d.assessment, d.type, d.group, d.grade, d.pct, d.submitDate, d.status],
    rows: examRows.map(e => {
      const sub = subByExam.get(e.id)
      const max = sub?.max_score != null ? Number(sub.max_score) : (maxByExam.get(e.id) ?? 0)
      if (!sub) return [e.title, typeLabel(e.type, d), groupName.get(e.group_id) ?? '·', '·', '·', '·', d.notSubmitted]
      if (sub.score == null) return [e.title, typeLabel(e.type, d), groupName.get(e.group_id) ?? '·', '·', '·', fmtDate(sub.submitted_at, lang), d.awaitingGrading]
      return [e.title, typeLabel(e.type, d), groupName.get(e.group_id) ?? '·',
        `${sub.score}/${max}`, max ? `${pct(Number(sub.score), max)}%` : '·', fmtDate(sub.submitted_at, lang), d.graded]
    }),
  }

  const own = sumScores(subRows, maxByExam)
  const { data: peerSubs } = examIds.length
    ? await admin.from('exam_submissions').select('exam_id, student_id, score, max_score, is_graded, is_flagged, submitted_at').in('exam_id', examIds)
    : { data: [] }
  const peers = sumScores((peerSubs ?? []) as SubRow[], maxByExam)
  const ownPct = own.totalMax ? pct(own.total, own.totalMax) : null
  const peerPct = peers.totalMax ? pct(peers.total, peers.totalMax) : null
  const summary: ReportTable = {
    heading: d.overallSummary,
    columns: [d.totalScores, d.gpa, d.peersAvg, d.position],
    rows: [[own.totalMax ? `${own.total}/${own.totalMax}` : '·',
      ownPct != null ? `${ownPct}%` : '·',
      peerPct != null ? `${peerPct}%` : '·',
      ownPct != null && peerPct != null ? (ownPct >= peerPct ? d.above : d.below) : '·']],
  }

  const missing: ReportTable = {
    heading: d.missing,
    columns: [d.assessment, d.type, d.group, d.createdAt],
    rows: examRows.filter(e => !subByExam.has(e.id))
      .map(e => [e.title, typeLabel(e.type, d), groupName.get(e.group_id) ?? '·', fmtDate(e.created_at, lang)]),
  }

  const graded = subRows
    .filter(s => s.score != null && s.submitted_at)
    .sort((a, b) => new Date(a.submitted_at!).getTime() - new Date(b.submitted_at!).getTime())
  let trendRows: (string | number)[][] = []
  if (graded.length >= 4) {
    const half = Math.floor(graded.length / 2)
    const first = sumScores(graded.slice(0, half), maxByExam)
    const second = sumScores(graded.slice(half), maxByExam)
    const p1 = first.totalMax ? pct(first.total, first.totalMax) : 0
    const p2 = second.totalMax ? pct(second.total, second.totalMax) : 0
    trendRows = [[`${p1}%`, `${p2}%`, p2 > p1 ? d.improved : p2 < p1 ? d.declined : d.stable]]
  }
  const trend: ReportTable = {
    heading: d.trend,
    columns: [d.firstHalf, d.secondHalf, d.trendCol],
    rows: trendRows,
  }

  const flagged = subRows.filter(s => s.is_flagged)
  const integrity: ReportTable = {
    heading: d.integrity,
    columns: [d.flaggedOf, d.outOf],
    rows: [[flagged.length, subRows.length]],
  }

  return {
    title: `${d.studentReport}: ${student.full_name}`,
    subtitle: `${student.email} · ${activeGroups.length} ${d.uGroup} · ${examRows.length} ${d.uAssessmentDue}`,
    university: universityName,
    generatedAt: new Date().toISOString(),
    lang,
    tables: [card, gradeSheet, summary, missing, trend, integrity],
  }
}

// ── CSV serialization ─────────────────────────────────────────────
export function reportToCsv(report: Report): string {
  const esc = (v: string | number) => {
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines: string[] = [report.title, ...(report.university ? [report.university] : []), report.subtitle, '']
  for (const t of report.tables) {
    lines.push(t.heading)
    lines.push(t.columns.map(esc).join(','))
    for (const row of t.rows) lines.push(row.map(esc).join(','))
    lines.push('')
  }
  return '﻿' + lines.join('\r\n') // BOM for Arabic in Excel
}
