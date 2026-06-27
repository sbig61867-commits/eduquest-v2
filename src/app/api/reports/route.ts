import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  canAccessReport, reportsAdminClient, reportToCsv,
  buildUniversityReport, buildTeacherReport, buildGroupReport,
  type ReportScope,
} from '@/lib/reports'

// GET /api/reports?scope=university|teacher|group&id=<uuid>&format=json|csv
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('users').select('role, tenant_id').eq('id', user.id).single()
  if (!profile) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const scope = searchParams.get('scope') as ReportScope | null
  const id = searchParams.get('id')
  const format = searchParams.get('format') ?? 'json'

  if (!scope || !['university', 'teacher', 'group'].includes(scope)) {
    return NextResponse.json({ error: 'scope must be university, teacher, or group' }, { status: 400 })
  }
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const access = canAccessReport(profile, scope)
  if (!access.ok) return NextResponse.json({ error: access.reason ?? 'Forbidden' }, { status: 403 })

  const admin = reportsAdminClient()
  const report =
    scope === 'university' ? await buildUniversityReport(admin, id) :
    scope === 'teacher'    ? await buildTeacherReport(admin, id) :
                             await buildGroupReport(admin, id)

  if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (format === 'csv') {
    const filename = `report_${scope}_${new Date().toISOString().slice(0, 10)}.csv`
    return new Response(reportToCsv(report), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  }

  return NextResponse.json(report)
}
