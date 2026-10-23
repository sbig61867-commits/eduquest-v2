import { currentCtx } from '@/lib/auth/current'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run } from '@/lib/db/sql'
import { buildXlsx, type Cell } from '@/lib/xlsx'
import { getTranslations, getLocale } from 'next-intl/server'
import { toLocale } from '@/i18n/config'

const DATE_LOCALE = { ar: 'ar-u-ca-gregory-nu-latn', en: 'en-GB' } as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REPORT_LIMIT = 5000

interface AppealRow {
  id: string; tenant_id: string; exam_id: string; submission_id: string; student_id: string; teacher_id: string
  group_id: string; violation_type: string | null; violation_at: string | null; student_name: string
  teacher_name: string; group_name: string; exam_title: string; student_message: string; status: string
  teacher_response: string | null; resolved_by: string | null; resolved_at: string | null; created_at: string
}

// GET /api/appeals/report — full appeals report for the caller's tenant (or,
// for super_admin, optionally ?tenant_id=). Every appeal is already
// self-contained (denormalized snapshots — see exam_appeals_migration.sql),
// so this is a plain RLS-scoped read as the caller: no service scope, and a
// teacher hitting this endpoint transparently gets only their own exams'
// appeals (exam_appeals_select already restricts that).
export async function GET(request: Request) {
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  if (!ctx.tenant_id && ctx.role !== 'super_admin') {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const format = searchParams.get('format') ?? 'json'
  const statusParam = searchParams.get('status') // pending | upheld | rejected
  const status = statusParam && ['pending', 'upheld', 'rejected'].includes(statusParam) ? statusParam : null
  // RLS already scopes: student -> own, teacher -> own exams, university_admin
  // -> own tenant, super_admin -> all. No manual tenant filter needed, but a
  // super_admin narrowing to one tenant explicitly is still honored:
  const tenantParam = searchParams.get('tenant_id')
  const tenant = tenantParam && ctx.role === 'super_admin' && UUID.test(tenantParam) ? tenantParam : null

  let appeals: AppealRow[]
  try {
    const [rows] = await run({ as: 'user', userId: ctx.sub }, sql => [
      sql`select id, tenant_id, exam_id, submission_id, student_id, teacher_id, group_id, violation_type, violation_at,
                 student_name, teacher_name, group_name, exam_title, student_message, status, teacher_response,
                 resolved_by, resolved_at, created_at
            from public.exam_appeals
           where (${status}::text is null or status = ${status}::text)
             and (${tenant}::uuid is null or tenant_id = ${tenant}::uuid)
           order by created_at desc
           limit ${REPORT_LIMIT}`,
    ])
    appeals = rows as unknown as AppealRow[]
  } catch (e) {
    console.error('[api/appeals/report]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('reportFailed')) }, { status: 500 })
  }

  if (format === 'json') {
    return NextResponse.json({ count: appeals.length, appeals })
  }

  if (!appeals.length) return NextResponse.json({ ...(await apiErr('noData')) }, { status: 404 })

  // The sheet is written in the downloader's language.
  const [t, tr, locale] = await Promise.all([
    getTranslations('reports.exports.appeals'),
    getTranslations('reports.exports'),
    getLocale().then(toLocale),
  ])
  const when = (iso: string) => new Date(iso).toLocaleString(DATE_LOCALE[locale])
  const STATUSES = ['pending', 'upheld', 'rejected'] as const
  const statusLabel = (s: string) => ((STATUSES as readonly string[]).includes(s) ? t(`status.${s as typeof STATUSES[number]}`) : s)
  const COLUMNS = ['submittedAt', 'student', 'group', 'exam', 'teacher', 'violationType', 'violationAt', 'message', 'status', 'response', 'resolvedAt'] as const
  const headers = COLUMNS.map(c => t(`columns.${c}`))
  const sheet: Cell[][] = [
    [t('title')],
    [tr('exportedOn', { date: new Date().toISOString().slice(0, 10) })],
    [],
    headers,
    ...appeals.map(a => [
      when(a.created_at),
      a.student_name,
      a.group_name,
      a.exam_title,
      a.teacher_name,
      a.violation_type ?? t('generalViolation'),
      a.violation_at ? when(a.violation_at) : '—',
      a.student_message,
      statusLabel(a.status),
      a.teacher_response ?? '—',
      a.resolved_at ? when(a.resolved_at) : '—',
    ]),
  ]

  const buf = await buildXlsx(sheet, t('sheet'))
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="exam_appeals_${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  })
}
