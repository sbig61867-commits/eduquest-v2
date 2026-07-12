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
  generatedAt: string
  tables: ReportTable[]
}

export type ReportScope = 'university' | 'teacher' | 'group' | 'student'

export interface CallerProfile { role: string; tenant_id: string | null }

// ── Authorization (future-ready) ──────────────────────────────────
// Today only super_admin may pull reports. The structure below is where
// per-role scoping goes later (university_admin → own tenant, teacher →
// own groups). Returning a reason keeps the API messages clear.
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
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('ar') : '—')
const typeLabel = (t: string) => (t === 'homework' ? 'واجب' : 'اختبار')

/** Sum graded submission scores; max falls back to the exam's question points. */
function sumScores(subs: SubRow[], maxByExam: Map<string, number>) {
  let total = 0, totalMax = 0
  for (const s of subs) {
    if (s.score == null) continue
    total += Number(s.score)
    totalMax += s.max_score != null ? Number(s.max_score) : (maxByExam.get(s.exam_id) ?? 0)
  }
  return { total, totalMax }
}

/** Grade distribution buckets over graded submissions. */
function distributionTable(subs: SubRow[], maxByExam: Map<string, number>): ReportTable {
  const buckets = [
    { label: 'ممتاز (90–100%)', min: 90, count: 0 },
    { label: 'جيد جداً (80–89%)', min: 80, count: 0 },
    { label: 'جيد (70–79%)', min: 70, count: 0 },
    { label: 'مقبول (50–69%)', min: 50, count: 0 },
    { label: 'ضعيف (أقل من 50%)', min: 0, count: 0 },
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
    heading: 'توزيع الدرجات',
    columns: ['الشريحة', 'عدد التسليمات', 'النسبة من المصحح'],
    rows: buckets.map(b => [b.label, b.count, graded ? `${Math.round((b.count / graded) * 100)}%` : '—']),
  }
}

// ══════════════════════════════════════════════════════════════════
// University report — executive summary, teachers, groups,
// grade distribution, 30-day activity, exam integrity.
// ══════════════════════════════════════════════════════════════════
export async function buildUniversityReport(admin: SupabaseClient, tenantId: string): Promise<Report | null> {
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

  // Group membership counts (one batched query)
  const groupIds = (groups ?? []).map(g => g.id)
  const { data: memberships } = groupIds.length
    ? await admin.from('group_students').select('group_id, student_id').in('group_id', groupIds)
    : { data: [] as Array<{ group_id: string; student_id: string }> }
  const membersByGroup = new Map<string, number>()
  for (const m of memberships ?? []) membersByGroup.set(m.group_id, (membersByGroup.get(m.group_id) ?? 0) + 1)

  const teacherName = new Map(teachers.map(t => [t.id, t.full_name]))
  const overall = sumScores(subRows, maxByExam)

  // 1. Executive summary
  const summary: ReportTable = {
    heading: 'الملخص التنفيذي',
    columns: ['المعلمون', 'الطلاب', 'المجموعات', 'التقييمات', 'الدروس المنشورة', 'التسليمات', 'متوسط الأداء العام'],
    rows: [[teachers.length, students.length, (groups ?? []).length, examRows.length, lessonCount ?? 0, subRows.length,
      overall.totalMax ? `${pct(overall.total, overall.totalMax)}%` : '—']],
  }

  // 2. Teachers
  const teacherTable: ReportTable = {
    heading: 'المعلمون',
    columns: ['المعلم', 'البريد', 'المجموعات', 'الطلاب', 'التقييمات', 'متوسط أداء طلابه'],
    rows: teachers.map(t => {
      const tGroups = (groups ?? []).filter(g => g.teacher_id === t.id)
      const tStudents = tGroups.reduce((s, g) => s + (membersByGroup.get(g.id) ?? 0), 0)
      const tExamIds = new Set(examRows.filter(e => e.teacher_id === t.id).map(e => e.id))
      const tSubs = subRows.filter(s => tExamIds.has(s.exam_id))
      const agg = sumScores(tSubs, maxByExam)
      return [t.full_name, t.email, tGroups.length, tStudents, tExamIds.size,
        agg.totalMax ? `${pct(agg.total, agg.totalMax)}%` : '—']
    }),
  }

  // 3. Groups
  const groupTable: ReportTable = {
    heading: 'المجموعات',
    columns: ['المجموعة', 'المعلم', 'الطلاب', 'التقييمات', 'متوسط الأداء'],
    rows: (groups ?? []).map(g => {
      const gExamIds = new Set(examRows.filter(e => e.group_id === g.id).map(e => e.id))
      const gSubs = subRows.filter(s => gExamIds.has(s.exam_id))
      const agg = sumScores(gSubs, maxByExam)
      return [g.name, teacherName.get(g.teacher_id) ?? '—', membersByGroup.get(g.id) ?? 0, gExamIds.size,
        agg.totalMax ? `${pct(agg.total, agg.totalMax)}%` : '—']
    }),
  }

  // 4. Grade distribution
  const distribution = distributionTable(subRows, maxByExam)

  // 5. 30-day activity
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
  const recentExams = examRows.filter(e => new Date(e.created_at).getTime() >= cutoff).length
  const recentSubs = subRows.filter(s => s.submitted_at && new Date(s.submitted_at).getTime() >= cutoff).length
  const activity: ReportTable = {
    heading: 'النشاط (آخر 30 يوماً)',
    columns: ['تقييمات جديدة', 'تسليمات الطلاب'],
    rows: [[recentExams, recentSubs]],
  }

  // 6. Exam integrity — flagged submissions per exam (top offenders first)
  const flaggedByExam = new Map<string, number>()
  for (const s of subRows) if (s.is_flagged) flaggedByExam.set(s.exam_id, (flaggedByExam.get(s.exam_id) ?? 0) + 1)
  const integrity: ReportTable = {
    heading: 'نزاهة الاختبارات (تسليمات عليها مخالفات)',
    columns: ['الاختبار', 'المعلم', 'تسليمات مخالِفة'],
    rows: [...flaggedByExam.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([examId, n]) => {
        const e = examRows.find(x => x.id === examId)
        return [e?.title ?? '—', teacherName.get(e?.teacher_id ?? '') ?? '—', n]
      }),
  }

  return {
    title: `تقرير جامعة: ${tenant.name}`,
    subtitle: `${teachers.length} معلم · ${students.length} طالب · ${(groups ?? []).length} مجموعة`,
    generatedAt: new Date().toISOString(),
    tables: [summary, teacherTable, groupTable, distribution, activity, integrity],
  }
}

// ══════════════════════════════════════════════════════════════════
// Teacher report — summary, groups, per-assessment detail,
// struggling students, grading discipline.
// ══════════════════════════════════════════════════════════════════
export async function buildTeacherReport(admin: SupabaseClient, teacherId: string): Promise<Report | null> {
  const { data: teacher } = await admin.from('users').select('id, full_name, email').eq('id', teacherId).single()
  if (!teacher) return null

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

  // 1. Summary
  const totalStudents = new Set(memberRows.map(m => m.student_id)).size
  const overall = sumScores(subRows, maxByExam)
  const summary: ReportTable = {
    heading: 'الملخص',
    columns: ['المجموعات', 'الطلاب', 'الدروس المنشورة', 'التقييمات', 'متوسط أداء الطلاب'],
    rows: [[(groups ?? []).length, totalStudents, lessonCount ?? 0, examRows.length,
      overall.totalMax ? `${pct(overall.total, overall.totalMax)}%` : '—']],
  }

  // 2. Groups with submission rate
  const groupTable: ReportTable = {
    heading: 'المجموعات',
    columns: ['المجموعة', 'الطلاب', 'التقييمات', 'نسبة التسليم', 'متوسط الأداء'],
    rows: (groups ?? []).map(g => {
      const gMembers = membersByGroup.get(g.id) ?? []
      const gExams = examRows.filter(e => e.group_id === g.id)
      const gExamIds = new Set(gExams.map(e => e.id))
      const gSubs = subRows.filter(s => gExamIds.has(s.exam_id))
      const expected = gMembers.length * gExams.length
      const agg = sumScores(gSubs, maxByExam)
      return [g.name, gMembers.length, gExams.length,
        expected ? `${Math.round((gSubs.length / expected) * 100)}%` : '—',
        agg.totalMax ? `${pct(agg.total, agg.totalMax)}%` : '—']
    }),
  }

  // 3. Per-assessment detail
  const assessmentTable: ReportTable = {
    heading: 'تفصيل التقييمات',
    columns: ['التقييم', 'النوع', 'المجموعة', 'سلّم / المطلوب', 'المتوسط', 'الأعلى', 'الأدنى', 'بانتظار تصحيح'],
    rows: examRows.map(e => {
      const eSubs = subRows.filter(s => s.exam_id === e.id)
      const graded = eSubs.filter(s => s.score != null)
      const max = maxByExam.get(e.id) ?? 0
      const pcts = graded.map(s => pct(Number(s.score), s.max_score != null ? Number(s.max_score) : max))
      const expected = (membersByGroup.get(e.group_id) ?? []).length
      return [e.title, typeLabel(e.type), groupName.get(e.group_id) ?? '—',
        `${eSubs.length} / ${expected}`,
        pcts.length ? `${Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length)}%` : '—',
        pcts.length ? `${Math.max(...pcts)}%` : '—',
        pcts.length ? `${Math.min(...pcts)}%` : '—',
        eSubs.filter(s => !s.is_graded).length]
    }),
  }

  // 4. Struggling students (avg < 50% across this teacher's assessments)
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
      strugglingRows.push([info?.full_name ?? '—', info?.email ?? '—', `${pct(agg.total, agg.totalMax)}%`, sSubs.length])
    }
  }
  const struggling: ReportTable = {
    heading: 'طلاب متعثرون (أقل من 50%)',
    columns: ['الطالب', 'البريد', 'المتوسط', 'عدد التسليمات'],
    rows: strugglingRows.sort((a, b) => parseInt(String(a[2])) - parseInt(String(b[2]))),
  }

  // 5. Grading discipline — assessments with pending grading
  const pendingRows = examRows
    .map(e => {
      const pending = subRows.filter(s => s.exam_id === e.id && !s.is_graded).length
      return { e, pending }
    })
    .filter(x => x.pending > 0)
    .map(x => [x.e.title, groupName.get(x.e.group_id) ?? '—', x.pending] as (string | number)[])
  const discipline: ReportTable = {
    heading: 'تسليمات بانتظار التصحيح',
    columns: ['التقييم', 'المجموعة', 'عدد غير المصحح'],
    rows: pendingRows,
  }

  return {
    title: `تقرير معلم: ${teacher.full_name}`,
    subtitle: `${teacher.email} · ${(groups ?? []).length} مجموعة · ${totalStudents} طالب`,
    generatedAt: new Date().toISOString(),
    tables: [summary, groupTable, assessmentTable, struggling, discipline],
  }
}

// ══════════════════════════════════════════════════════════════════
// Group report — the per-student grade matrix (unchanged behaviour,
// now soft-delete aware) plus a summary header.
// ══════════════════════════════════════════════════════════════════
export async function buildGroupReport(admin: SupabaseClient, groupId: string): Promise<Report | null> {
  const { data: group } = await admin
    .from('groups').select('id, name, tenant_id, users:teacher_id(full_name)').eq('id', groupId).single()
  if (!group) return null

  const [{ data: exams }, { data: members }] = await Promise.all([
    admin.from('exams').select('id, title, type, questions').eq('group_id', groupId).is('deleted_at', null).order('created_at', { ascending: true }),
    admin.from('group_students').select('student_id, users(full_name, email)').eq('group_id', groupId),
  ])
  const examIds = (exams ?? []).map(e => e.id)
  const { data: subs } = examIds.length
    ? await admin.from('exam_submissions').select('exam_id, student_id, score').in('exam_id', examIds)
    : { data: [] as Array<{ exam_id: string; student_id: string; score: number | null }> }

  const columns = ['الطالب', 'البريد', ...(exams ?? []).map(e => `${e.type === 'homework' ? '[واجب] ' : ''}${e.title}`), 'المجموع', 'النسبة %']
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (members as any[] ?? []).map((m: any) => {
    let total = 0, totalMax = 0
    const cells = (exams ?? []).map(e => {
      const sub = (subs ?? []).find(s => s.exam_id === e.id && s.student_id === m.student_id)
      const max = examMax(e.questions)
      if (sub?.score != null) { total += Number(sub.score); totalMax += max; return `${sub.score}/${max}` }
      return '—'
    })
    return [m.users?.full_name ?? '—', m.users?.email ?? '', ...cells, totalMax ? `${total}/${totalMax}` : '—', totalMax ? String(pct(total, totalMax)) : '—']
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const teacherName = (group as any).users?.full_name ?? '—'
  return {
    title: `تقرير مجموعة: ${group.name}`,
    subtitle: `المعلم: ${teacherName} · ${(members ?? []).length} طالب · ${(exams ?? []).length} تقييم`,
    generatedAt: new Date().toISOString(),
    tables: [{ heading: 'درجات الطلاب', columns, rows }],
  }
}

// ══════════════════════════════════════════════════════════════════
// Student report — printable transcript for a parent/administration:
// profile card, full grade sheet, overall vs group average,
// missing submissions, performance trend, integrity.
// ══════════════════════════════════════════════════════════════════
export async function buildStudentReport(admin: SupabaseClient, studentId: string): Promise<Report | null> {
  const { data: student } = await admin
    .from('users').select('id, full_name, email, created_at').eq('id', studentId).single()
  if (!student) return null

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

  // 1. Profile card
  const card: ReportTable = {
    heading: 'بطاقة الطالب',
    columns: ['الاسم', 'البريد', 'تاريخ الانضمام', 'المجموعات'],
    rows: [[student.full_name, student.email, fmtDate(student.created_at),
      activeGroups.map(m => `${m.groups.name} (${m.groups.users?.full_name ?? '—'})`).join('، ') || '—']],
  }

  // 2. Full grade sheet
  const gradeSheet: ReportTable = {
    heading: 'كشف الدرجات',
    columns: ['التقييم', 'النوع', 'المجموعة', 'الدرجة', 'النسبة', 'تاريخ التسليم', 'الحالة'],
    rows: examRows.map(e => {
      const sub = subByExam.get(e.id)
      const max = sub?.max_score != null ? Number(sub.max_score) : (maxByExam.get(e.id) ?? 0)
      if (!sub) return [e.title, typeLabel(e.type), groupName.get(e.group_id) ?? '—', '—', '—', '—', 'لم يسلّم']
      if (sub.score == null) return [e.title, typeLabel(e.type), groupName.get(e.group_id) ?? '—', '—', '—', fmtDate(sub.submitted_at), 'بانتظار التصحيح']
      return [e.title, typeLabel(e.type), groupName.get(e.group_id) ?? '—',
        `${sub.score}/${max}`, max ? `${pct(Number(sub.score), max)}%` : '—', fmtDate(sub.submitted_at), 'مصحح']
    }),
  }

  // 3. Overall summary vs group average
  const own = sumScores(subRows, maxByExam)
  // Group average: all submissions on the same exams (one batched query)
  const { data: peerSubs } = examIds.length
    ? await admin.from('exam_submissions').select('exam_id, student_id, score, max_score, is_graded, is_flagged, submitted_at').in('exam_id', examIds)
    : { data: [] }
  const peers = sumScores((peerSubs ?? []) as SubRow[], maxByExam)
  const ownPct = own.totalMax ? pct(own.total, own.totalMax) : null
  const peerPct = peers.totalMax ? pct(peers.total, peers.totalMax) : null
  const summary: ReportTable = {
    heading: 'الملخص العام',
    columns: ['مجموع الدرجات', 'المعدل العام', 'متوسط المجموعات', 'الموقع'],
    rows: [[own.totalMax ? `${own.total}/${own.totalMax}` : '—',
      ownPct != null ? `${ownPct}%` : '—',
      peerPct != null ? `${peerPct}%` : '—',
      ownPct != null && peerPct != null ? (ownPct >= peerPct ? 'فوق المتوسط' : 'تحت المتوسط') : '—']],
  }

  // 4. Missing submissions — the most important lines for a parent
  const missing: ReportTable = {
    heading: 'تقييمات لم تُسلَّم',
    columns: ['التقييم', 'النوع', 'المجموعة', 'تاريخ الإنشاء'],
    rows: examRows.filter(e => !subByExam.has(e.id))
      .map(e => [e.title, typeLabel(e.type), groupName.get(e.group_id) ?? '—', fmtDate(e.created_at)]),
  }

  // 5. Trend — first half vs second half of graded submissions (chronological)
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
    trendRows = [[`${p1}%`, `${p2}%`, p2 > p1 ? 'تحسّن ↑' : p2 < p1 ? 'تراجع ↓' : 'ثابت']]
  }
  const trend: ReportTable = {
    heading: 'الاتجاه الزمني',
    columns: ['النصف الأول', 'النصف الأخير', 'التقييم'],
    rows: trendRows,
  }

  // 6. Integrity
  const flagged = subRows.filter(s => s.is_flagged)
  const integrity: ReportTable = {
    heading: 'نزاهة الاختبارات',
    columns: ['تسليمات عليها مخالفات', 'من أصل'],
    rows: [[flagged.length, subRows.length]],
  }

  return {
    title: `تقرير طالب: ${student.full_name}`,
    subtitle: `${student.email} · ${activeGroups.length} مجموعة · ${examRows.length} تقييم مستحق`,
    generatedAt: new Date().toISOString(),
    tables: [card, gradeSheet, summary, missing, trend, integrity],
  }
}

// ── CSV serialization ─────────────────────────────────────────────
export function reportToCsv(report: Report): string {
  const esc = (v: string | number) => {
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines: string[] = [report.title, report.subtitle, '']
  for (const t of report.tables) {
    lines.push(t.heading)
    lines.push(t.columns.map(esc).join(','))
    for (const row of t.rows) lines.push(row.map(esc).join(','))
    lines.push('')
  }
  return '﻿' + lines.join('\r\n') // BOM for Arabic in Excel
}
