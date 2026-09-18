import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildXlsx, type Cell } from '@/lib/xlsx'

// GET /api/appeals/report — full appeals report for the caller's tenant (or,
// for super_admin, optionally ?tenant_id=). Every appeal is already
// self-contained (denormalized snapshots — see exam_appeals_migration.sql),
// so this is a plain RLS-scoped read: no service-role client needed, and a
// teacher hitting this endpoint transparently gets only their own exams'
// appeals (exam_appeals_select already restricts that).
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'غير مصرّح' }, { status: 401 })

  const { data: profile } = await supabase
    .from('users').select('role, tenant_id').eq('id', user.id).single()
  if (!profile?.tenant_id && profile?.role !== 'super_admin') {
    return NextResponse.json({ error: 'ممنوع' }, { status: 403 })
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
    return NextResponse.json({ error: 'تعذّر جلب التقرير' }, { status: 500 })
  }

  if (format === 'json') {
    return NextResponse.json({ count: appeals?.length ?? 0, appeals: appeals ?? [] })
  }

  if (!appeals?.length) return NextResponse.json({ error: 'لا توجد بيانات' }, { status: 404 })

  const STATUS_LABEL: Record<string, string> = { pending: 'قيد المراجعة', upheld: 'قُبل الطعن', rejected: 'رُفض الطعن' }
  const headers = ['تاريخ التقديم', 'الطالب', 'المادة/المجموعة', 'الاختبار', 'المعلم المراقِب', 'نوع المخالفة المطعون بها', 'وقت المخالفة', 'نص الطعن', 'الحالة', 'رد المعلم', 'تاريخ البت']
  const sheet: Cell[][] = [
    ['تقرير طعونات المراقبة'],
    [`تاريخ التصدير: ${new Date().toISOString().slice(0, 10)}`],
    [],
    headers,
    ...appeals.map(a => [
      new Date(a.created_at).toLocaleString('ar'),
      a.student_name,
      a.group_name,
      a.exam_title,
      a.teacher_name,
      a.violation_type ?? 'عام (كل المخالفات)',
      a.violation_at ? new Date(a.violation_at).toLocaleString('ar') : '—',
      a.student_message,
      STATUS_LABEL[a.status] ?? a.status,
      a.teacher_response ?? '—',
      a.resolved_at ? new Date(a.resolved_at).toLocaleString('ar') : '—',
    ]),
  ]

  const buf = await buildXlsx(sheet, 'الطعونات')
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="exam_appeals_${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  })
}
