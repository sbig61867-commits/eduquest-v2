import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildXlsx, type Cell } from '@/lib/xlsx'
import { getTranslations, getLocale } from 'next-intl/server'
import { toLocale } from '@/i18n/config'

const DATE_LOCALE = { ar: 'ar-u-ca-gregory-nu-latn', en: 'en-GB' } as const

// GET /api/appeals/report — full appeals report for the caller's tenant (or,
// for super_admin, optionally ?tenant_id=). Every appeal is already
// self-contained (denormalized snapshots — see exam_appeals_migration.sql),
// so this is a plain RLS-scoped read: no service-role client needed, and a
// teacher hitting this endpoint transparently gets only their own exams'
// appeals (exam_appeals_select already restricts that).
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  const { data: profile } = await supabase
    .from('users').select('role, tenant_id').eq('id', user.id).single()
  if (!profile?.tenant_id && profile?.role !== 'super_admin') {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const format = searchParams.get('format') ?? 'json'
  const statusFilter = searchParams.get('status') // pending | upheld | rejected

  let query = supabase.from('exam_appeals').select('*').order('created_at', { ascending: false })
  if (statusFilter && ['pending', 'upheld', 'rejected'].includes(statusFilter)) {
    query = query.eq('status', statusFilter)
  }
  // RLS already scopes: student -> own, teacher -> own exams, university_admin
  // -> own tenant, super_admin -> all. No manual tenant filter needed, but a
  // super_admin narrowing to one tenant explicitly is still honored:
  const tenantParam = searchParams.get('tenant_id')
  if (tenantParam && profile?.role === 'super_admin') query = query.eq('tenant_id', tenantParam)

  const { data: appeals, error } = await query
  if (error) {
    console.error('[api/appeals/report]', error)
    return NextResponse.json({ ...(await apiErr('reportFailed')) }, { status: 500 })
  }

  if (format === 'json') {
    return NextResponse.json({ count: appeals?.length ?? 0, appeals: appeals ?? [] })
  }

  if (!appeals?.length) return NextResponse.json({ ...(await apiErr('noData')) }, { status: 404 })

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
