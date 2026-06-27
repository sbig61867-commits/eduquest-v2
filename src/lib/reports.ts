import { createClient as createAdminClient, SupabaseClient } from '@supabase/supabase-js'

// ── Generic report shape ──────────────────────────────────────────
// Every report is a list of sections; each section is a titled table.
// This single shape renders to an HTML/print view AND serializes to CSV,
// so all three report types share one rendering + export path.
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

export type ReportScope = 'university' | 'teacher' | 'group'

export interface CallerProfile { role: string; tenant_id: string | null }

// ── Authorization (future-ready) ──────────────────────────────────
// Today only super_admin may pull reports. The structure below is where
// per-role scoping goes later (university_admin → own tenant, teacher →
// own groups). Returning a reason keeps the API messages clear.
export function canAccessReport(profile: CallerProfile, _scope: ReportScope): { ok: boolean; reason?: string } {
  if (profile.role === 'super_admin') return { ok: true }
  // Placeholder for future expansion — intentionally denied for now.
  // e.g. university_admin: verify the target belongs to profile.tenant_id
  //      teacher: verify the target group/teacher is the caller's own.
  return { ok: false, reason: 'Reports are currently restricted to the platform owner.' }
}

export function reportsAdminClient(): SupabaseClient {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// ── Helpers ───────────────────────────────────────────────────────
function examMax(questions: unknown): number {
  if (!Array.isArray(questions)) return 0
  return (questions as Array<{ points?: number }>).reduce((s, q) => s + (q.points ?? 0), 0)
}
const pct = (score: number, max: number) => (max > 0 ? Math.round((score / max) * 100) : 0)

// ── Builders ──────────────────────────────────────────────────────

export async function buildGroupReport(admin: SupabaseClient, groupId: string): Promise<Report | null> {
  const { data: group } = await admin
    .from('groups').select('id, name, tenant_id, users:teacher_id(full_name)').eq('id', groupId).single()
  if (!group) return null

  const [{ data: exams }, { data: members }] = await Promise.all([
    admin.from('exams').select('id, title, type, questions').eq('group_id', groupId).order('created_at', { ascending: true }),
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

export async function buildTeacherReport(admin: SupabaseClient, teacherId: string): Promise<Report | null> {
  const { data: teacher } = await admin
    .from('users').select('id, full_name, email').eq('id', teacherId).single()
  if (!teacher) return null

  const { data: groups } = await admin
    .from('groups').select('id, name').eq('teacher_id', teacherId).order('created_at', { ascending: true })

  const groupRows: (string | number)[][] = []
  for (const g of groups ?? []) {
    const [{ count: studentCount }, { data: exams }] = await Promise.all([
      admin.from('group_students').select('student_id', { count: 'exact', head: true }).eq('group_id', g.id),
      admin.from('exams').select('id, questions').eq('group_id', g.id),
    ])
    const examIds = (exams ?? []).map(e => e.id)
    const { data: subs } = examIds.length
      ? await admin.from('exam_submissions').select('exam_id, score').in('exam_id', examIds)
      : { data: [] as Array<{ exam_id: string; score: number | null }> }
    let total = 0, totalMax = 0
    for (const e of exams ?? []) {
      const max = examMax(e.questions)
      for (const s of (subs ?? []).filter(x => x.exam_id === e.id)) {
        if (s.score != null) { total += Number(s.score); totalMax += max }
      }
    }
    groupRows.push([g.name, studentCount ?? 0, (exams ?? []).length, totalMax ? `${pct(total, totalMax)}%` : '—'])
  }

  return {
    title: `تقرير معلم: ${teacher.full_name}`,
    subtitle: `${teacher.email} · ${(groups ?? []).length} مجموعة`,
    generatedAt: new Date().toISOString(),
    tables: [{ heading: 'المجموعات', columns: ['المجموعة', 'عدد الطلاب', 'عدد التقييمات', 'متوسط الأداء'], rows: groupRows }],
  }
}

export async function buildUniversityReport(admin: SupabaseClient, tenantId: string): Promise<Report | null> {
  const { data: tenant } = await admin.from('tenants').select('id, name').eq('id', tenantId).single()
  if (!tenant) return null

  const { data: teachers } = await admin
    .from('users').select('id, full_name, email').eq('tenant_id', tenantId).eq('role', 'teacher').order('full_name')
  const { count: studentCount } = await admin
    .from('users').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('role', 'student')

  const teacherRows: (string | number)[][] = []
  for (const t of teachers ?? []) {
    const { data: groups } = await admin.from('groups').select('id').eq('teacher_id', t.id)
    const groupIds = (groups ?? []).map(g => g.id)
    const [{ count: examCount }, studentsAgg] = await Promise.all([
      admin.from('exams').select('id', { count: 'exact', head: true }).eq('teacher_id', t.id),
      groupIds.length
        ? admin.from('group_students').select('student_id', { count: 'exact', head: true }).in('group_id', groupIds)
        : Promise.resolve({ count: 0 }),
    ])
    teacherRows.push([t.full_name, t.email, groupIds.length, studentsAgg.count ?? 0, examCount ?? 0])
  }

  return {
    title: `تقرير جامعة: ${tenant.name}`,
    subtitle: `${(teachers ?? []).length} معلم · ${studentCount ?? 0} طالب`,
    generatedAt: new Date().toISOString(),
    tables: [{
      heading: 'المعلمون',
      columns: ['المعلم', 'البريد', 'المجموعات', 'الطلاب', 'الاختبارات'],
      rows: teacherRows,
    }],
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
