import { createClient as createAdminClient, SupabaseClient } from '@supabase/supabase-js'
import arReports from '@/messages/ar/reports.json'
import enReports from '@/messages/en/reports.json'
import {
  loadGroupReportData, loadPilotData, loadStudentData, loadTeacherData, loadUniversityData,
  type ReportExam, type ReportSub,
} from '@/lib/data/reports'

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
  return { ok: false, reason: 'reportsRestricted' }
}

export function reportsAdminClient(): SupabaseClient {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// ── Bilingual strings ─────────────────────────────────────────────
// Every heading/column/status the builders emit, from the server-only
// `reports` message namespace (src/messages/<locale>/reports.json). A report
// renders in the language it was REQUESTED in, not the viewer's UI language,
// so the dictionary is picked by `lang` rather than through next-intl's
// request locale.
const STR = { ar: arReports.labels, en: enReports.labels }
type Dict = typeof enReports.labels

/** Letterhead / signature / footer labels, in the report's own language. */
export type ReportChrome = typeof enReports.chrome
export function reportChrome(lang: ReportLang): ReportChrome {
  return (lang === 'ar' ? arReports : enReports).chrome
}

// ── Helpers (computed in memory from the reads in src/lib/data/reports.ts) ──
// A submission's maximum is its own max_score: finalize_exam_submission writes
// the sum of the exam's points (the rule the old question-based fallback used),
// so the questions are no longer read.
const maxOf = (s: { max_score: number | null }) => (s.max_score != null ? Number(s.max_score) : 0)
const pct = (score: number, max: number) => (max > 0 ? Math.round((score / max) * 100) : 0)
const fmtDate = (iso: string | null, lang: ReportLang) =>
  iso ? new Date(iso).toLocaleDateString(lang === 'ar' ? 'ar-u-ca-gregory-nu-latn' : 'en-GB') : '·'
const typeLabel = (t: string, d: Dict) => (t === 'homework' ? d.homework : d.examType)

/** Rows grouped by a key, each group in the input order. */
function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const r of rows) {
    const k = key(r)
    const arr = out.get(k)
    if (arr) arr.push(r)
    else out.set(k, [r])
  }
  return out
}

/** One submission per exam × student (the table's unique pair): the matrix cell lookup. */
function cellIndex<T extends { exam_id: string; student_id: string }>(subs: T[]): Map<string, T> {
  const out = new Map<string, T>()
  for (const s of subs) {
    const k = `${s.exam_id} ${s.student_id}`
    if (!out.has(k)) out.set(k, s)
  }
  return out
}

function sumScores(subs: Pick<ReportSub, 'score' | 'max_score'>[]) {
  let total = 0, totalMax = 0
  for (const s of subs) {
    if (s.score == null) continue
    total += Number(s.score)
    totalMax += maxOf(s)
  }
  return { total, totalMax }
}

function distributionTable(subs: Pick<ReportSub, 'score' | 'max_score'>[], d: Dict): ReportTable {
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
    const max = maxOf(s)
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

/** Per-student × per-assessment grade matrix (group and pilot reports). */
function gradeMatrix(
  exams: Pick<ReportExam, 'id' | 'title' | 'type'>[], members: { student_id: string; users: { full_name: string; email: string } | null }[],
  subs: ReportSub[], d: Dict,
): ReportTable {
  const cell = cellIndex(subs)
  return {
    heading: d.studentGrades,
    columns: [d.student, d.email, ...exams.map(e => `${e.type === 'homework' ? d.homeworkTag : ''}${e.title}`), d.total, d.pctCol],
    rows: members.map(m => {
      let total = 0, totalMax = 0
      const cells = exams.map(e => {
        const sub = cell.get(`${e.id} ${m.student_id}`)
        if (sub?.score != null) { const max = maxOf(sub); total += Number(sub.score); totalMax += max; return `${sub.score}/${max}` }
        return '·'
      })
      return [m.users?.full_name ?? '·', m.users?.email ?? '', ...cells, totalMax ? `${total}/${totalMax}` : '·', totalMax ? String(pct(total, totalMax)) : '·']
    }),
  }
}

// ══════════════════════════════════════════════════════════════════
// University report
// ══════════════════════════════════════════════════════════════════
export async function buildUniversityReport(admin: SupabaseClient, tenantId: string, lang: ReportLang = 'ar'): Promise<Report | null> {
  const d = STR[lang]
  const data = await loadUniversityData(admin, tenantId)
  if (!data) return null
  const { tenant, teachers, studentCount, groups, exams: examRows, lessonCount, subs: subRows, memberships } = data

  const membersByGroup = new Map<string, number>()
  for (const m of memberships) membersByGroup.set(m.group_id, (membersByGroup.get(m.group_id) ?? 0) + 1)
  const subsByExam = groupBy(subRows, s => s.exam_id)
  const examsByTeacher = groupBy(examRows, e => e.teacher_id)
  const examsByGroup = groupBy(examRows, e => e.group_id)
  const groupsByTeacher = groupBy(groups, g => g.teacher_id)
  const subsOf = (exams: ReportExam[] | undefined) => (exams ?? []).flatMap(e => subsByExam.get(e.id) ?? [])

  const teacherName = new Map(teachers.map(t => [t.id, t.full_name]))
  const overall = sumScores(subRows)

  const summary: ReportTable = {
    heading: d.execSummary,
    columns: [d.teachers, d.students, d.groups, d.assessments, d.lessonsPublished, d.submissions, d.avgOverall],
    rows: [[teachers.length, studentCount, groups.length, examRows.length, lessonCount, subRows.length,
      overall.totalMax ? `${pct(overall.total, overall.totalMax)}%` : '·']],
  }

  const teacherTable: ReportTable = {
    heading: d.teachers,
    columns: [d.teacher, d.email, d.groups, d.students, d.assessments, d.avgTheirStudents],
    rows: teachers.map(t => {
      const tGroups = groupsByTeacher.get(t.id) ?? []
      const tStudents = tGroups.reduce((s, g) => s + (membersByGroup.get(g.id) ?? 0), 0)
      const tExams = examsByTeacher.get(t.id)
      const agg = sumScores(subsOf(tExams))
      return [t.full_name, t.email, tGroups.length, tStudents, tExams?.length ?? 0,
        agg.totalMax ? `${pct(agg.total, agg.totalMax)}%` : '·']
    }),
  }

  const groupTable: ReportTable = {
    heading: d.groups,
    columns: [d.group, d.teacher, d.students, d.assessments, d.avgPerf],
    rows: groups.map(g => {
      const gExams = examsByGroup.get(g.id)
      const agg = sumScores(subsOf(gExams))
      return [g.name, teacherName.get(g.teacher_id) ?? '·', membersByGroup.get(g.id) ?? 0, gExams?.length ?? 0,
        agg.totalMax ? `${pct(agg.total, agg.totalMax)}%` : '·']
    }),
  }

  const distribution = distributionTable(subRows, d)

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
  const examById = new Map(examRows.map(e => [e.id, e]))
  const integrity: ReportTable = {
    heading: d.integrityUni,
    columns: [d.exam, d.teacher, d.flaggedSubs],
    rows: [...flaggedByExam.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([examId, n]) => {
        const e = examById.get(examId)
        return [e?.title ?? '·', teacherName.get(e?.teacher_id ?? '') ?? '·', n]
      }),
  }

  return {
    title: `${d.universityReport}: ${tenant.name}`,
    subtitle: `${teachers.length} ${d.uTeacher} · ${studentCount} ${d.uStudent} · ${groups.length} ${d.uGroup}`,
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
  const data = await loadTeacherData(admin, teacherId)
  if (!data) return null
  const { teacher, groups, exams: examRows, lessonCount, members: memberRows, subs: subRows } = data
  const universityName = teacher.tenants?.name ?? undefined

  const groupName = new Map(groups.map(g => [g.id, g.name]))
  const membersByGroup = new Map<string, string[]>()
  for (const m of memberRows) {
    const arr = membersByGroup.get(m.group_id) ?? []
    arr.push(m.student_id)
    membersByGroup.set(m.group_id, arr)
  }
  const subsByExam = groupBy(subRows, s => s.exam_id)
  const examsByGroup = groupBy(examRows, e => e.group_id)

  const totalStudents = new Set(memberRows.map(m => m.student_id)).size
  const overall = sumScores(subRows)
  const summary: ReportTable = {
    heading: d.summary,
    columns: [d.groups, d.students, d.lessonsPublished, d.assessments, d.avgTheirStudents],
    rows: [[groups.length, totalStudents, lessonCount, examRows.length,
      overall.totalMax ? `${pct(overall.total, overall.totalMax)}%` : '·']],
  }

  const groupTable: ReportTable = {
    heading: d.groups,
    columns: [d.group, d.students, d.assessments, d.submissionRate, d.avgPerf],
    rows: groups.map(g => {
      const gMembers = membersByGroup.get(g.id) ?? []
      const gExams = examsByGroup.get(g.id) ?? []
      const gSubs = gExams.flatMap(e => subsByExam.get(e.id) ?? [])
      const expected = gMembers.length * gExams.length
      const agg = sumScores(gSubs)
      return [g.name, gMembers.length, gExams.length,
        expected ? `${Math.round((gSubs.length / expected) * 100)}%` : '·',
        agg.totalMax ? `${pct(agg.total, agg.totalMax)}%` : '·']
    }),
  }

  const assessmentTable: ReportTable = {
    heading: d.assessmentsDetail,
    columns: [d.assessment, d.type, d.group, d.submittedOf, d.avg, d.highest, d.lowest, d.pendingGrading],
    rows: examRows.map(e => {
      const eSubs = subsByExam.get(e.id) ?? []
      const graded = eSubs.filter(s => s.score != null)
      const pcts = graded.map(s => pct(Number(s.score), maxOf(s)))
      const expected = (membersByGroup.get(e.group_id) ?? []).length
      return [e.title, typeLabel(e.type, d), groupName.get(e.group_id) ?? '·',
        `${eSubs.length} / ${expected}`,
        pcts.length ? `${Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length)}%` : '·',
        pcts.length ? `${Math.max(...pcts)}%` : '·',
        pcts.length ? `${Math.min(...pcts)}%` : '·',
        eSubs.filter(s => !s.is_graded).length]
    }),
  }

  const byStudent = groupBy(subRows, s => s.student_id)
  const studentInfo = new Map(memberRows.map(m => [m.student_id, m.users]))
  const strugglingRows: (string | number)[][] = []
  for (const [studentId, sSubs] of byStudent) {
    const agg = sumScores(sSubs)
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
    .map(e => ({ e, pending: (subsByExam.get(e.id) ?? []).filter(s => !s.is_graded).length }))
    .filter(x => x.pending > 0)
    .map(x => [x.e.title, groupName.get(x.e.group_id) ?? '·', x.pending] as (string | number)[])
  const discipline: ReportTable = {
    heading: d.pendingTable,
    columns: [d.assessment, d.group, d.ungradedCount],
    rows: pendingRows,
  }

  return {
    title: `${d.teacherReport}: ${teacher.full_name}`,
    subtitle: `${teacher.email} · ${groups.length} ${d.uGroup} · ${totalStudents} ${d.uStudent}`,
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
  const data = await loadGroupReportData(admin, groupId)
  if (!data) return null
  const { group, exams, members, subs } = data
  const universityName = group.tenants?.name ?? undefined
  const teacherName = group.users?.full_name ?? '·'
  return {
    title: `${d.groupReport}: ${group.name}`,
    subtitle: `${d.teacherPrefix}: ${teacherName} · ${members.length} ${d.uStudent} · ${exams.length} ${d.uAssessment}`,
    university: universityName,
    generatedAt: new Date().toISOString(),
    lang,
    tables: [gradeMatrix(exams, members, subs, d)],
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
  const data = await loadPilotData(admin, groupId)
  if (!data) return null
  const { group, exams: examRows, members, lessonCount, subs: subRows, responses } = data
  const universityName = group.tenants?.name ?? undefined
  const teacherName = group.users?.full_name ?? '·'
  const overall = sumScores(subRows)

  // 1. Executive summary
  const autoGraded = subRows.filter(s => s.is_graded).length
  const hoursSaved = Math.round((autoGraded * MINUTES_SAVED_PER_AUTO_GRADED / 60) * 10) / 10
  const expected = members.length * examRows.length
  const summary: ReportTable = {
    heading: d.execSummaryPilot,
    columns: [d.students, d.lessonsPublished, d.assessments, d.submissions, d.submissionRate, d.avgOverall, d.hoursSaved],
    rows: [[members.length, lessonCount, examRows.length, subRows.length,
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
  const matrix = gradeMatrix(examRows, members, subRows, d)
  const distribution = distributionTable(subRows, d)

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
  const r = responses
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
    subtitle: `${d.teacherPrefix}: ${teacherName} · ${members.length} ${d.uStudent} · ${examRows.length} ${d.uAssessment}`,
    university: universityName,
    generatedAt: new Date().toISOString(),
    lang,
    tables: [summary, weekly, matrix, distribution, integrity, feedback, quotes],
  }
}

// ══════════════════════════════════════════════════════════════════
// Student report
// ══════════════════════════════════════════════════════════════════
export async function buildStudentReport(admin: SupabaseClient, studentId: string, lang: ReportLang = 'ar'): Promise<Report | null> {
  const d = STR[lang]
  const data = await loadStudentData(admin, studentId)
  if (!data) return null
  const { student, activeGroups, exams: examRows, peerSubs, ownSubs: subRows } = data
  const universityName = student.tenants?.name ?? undefined

  const subByExam = new Map(subRows.map(s => [s.exam_id, s]))
  const groupName = new Map(activeGroups.map(m => [m.groups.id, m.groups.name]))

  const card: ReportTable = {
    heading: d.card,
    columns: [d.name, d.email, d.joinDate, d.groups],
    rows: [[student.full_name, student.email, fmtDate(student.created_at, lang),
      activeGroups.map(m => `${m.groups.name} (${m.groups.users?.full_name ?? '·'})`).join(d.listSeparator) || '·']],
  }

  const gradeSheet: ReportTable = {
    heading: d.gradeSheet,
    columns: [d.assessment, d.type, d.group, d.grade, d.pct, d.submitDate, d.status],
    rows: examRows.map(e => {
      const sub = subByExam.get(e.id)
      if (!sub) return [e.title, typeLabel(e.type, d), groupName.get(e.group_id) ?? '·', '·', '·', '·', d.notSubmitted]
      if (sub.score == null) return [e.title, typeLabel(e.type, d), groupName.get(e.group_id) ?? '·', '·', '·', fmtDate(sub.submitted_at, lang), d.awaitingGrading]
      const max = maxOf(sub)
      return [e.title, typeLabel(e.type, d), groupName.get(e.group_id) ?? '·',
        `${sub.score}/${max}`, max ? `${pct(Number(sub.score), max)}%` : '·', fmtDate(sub.submitted_at, lang), d.graded]
    }),
  }

  const own = sumScores(subRows)
  const peers = sumScores(peerSubs)
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
    const first = sumScores(graded.slice(0, half))
    const second = sumScores(graded.slice(half))
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
