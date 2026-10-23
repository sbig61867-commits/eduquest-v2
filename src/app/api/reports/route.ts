import { currentCtx } from '@/lib/auth/current'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne } from '@/lib/db/sql'
import {
  canAccessReport, reportToCsv, reportChrome,
  buildUniversityReport, buildTeacherReport, buildGroupReport, buildStudentReport, buildPilotReport,
  type ReportScope, type ReportLang,
} from '@/lib/reports'
import { ReportReadError } from '@/lib/data/reports'

// GET /api/reports?scope=university|teacher|group|student|pilot&id=<uuid>&format=json|csv&lang=ar|en
export async function GET(request: Request) {
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  // The gate decides on the caller's LIVE row (owner only), read as the caller.
  const [me] = await run({ as: 'user', userId: ctx.sub }, sql => [
    sql`select role, tenant_id from public.users where id = ${ctx.sub} and is_active is not false`,
  ])
  const profile = maybeOne<{ role: string; tenant_id: string | null }>(me)
  if (!profile) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const scope = searchParams.get('scope') as ReportScope | null
  const id = searchParams.get('id')
  const format = searchParams.get('format') ?? 'json'
  const lang: ReportLang = searchParams.get('lang') === 'en' ? 'en' : 'ar'

  if (!scope || !['university', 'teacher', 'group', 'student', 'pilot'].includes(scope)) {
    return NextResponse.json({ ...(await apiErr('invalidReportScope')) }, { status: 400 })
  }
  if (!id) return NextResponse.json({ ...(await apiErr('missingId')) }, { status: 400 })
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ ...(await apiErr('notFound')) }, { status: 404 })
  }

  const access = canAccessReport(profile)
  if (!access.ok) return NextResponse.json({ ...(await apiErr('reportsRestricted')) }, { status: 403 })

  let report: Awaited<ReturnType<typeof buildGroupReport>>
  try {
    report =
      scope === 'university' ? await buildUniversityReport(id, lang) :
      scope === 'teacher'    ? await buildTeacherReport(id, lang) :
      scope === 'student'    ? await buildStudentReport(id, lang) :
      scope === 'pilot'      ? await buildPilotReport(id, lang) :
                               await buildGroupReport(id, lang)
  } catch (e) {
    // A failed or incomplete read never becomes a partial report (D1).
    if (!(e instanceof ReportReadError)) throw e
    console.error('[api/reports]', scope, e.message, e.detail ?? '')
    return NextResponse.json({ ...(await apiErr('reportReadFailed')) }, { status: 503 })
  }

  if (!report) return NextResponse.json({ ...(await apiErr('notFound')) }, { status: 404 })

  if (format === 'csv') {
    const filename = `report_${scope}_${new Date().toISOString().slice(0, 10)}.csv`
    return new Response(reportToCsv(report), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  }

  // The print view's letterhead must match the report's language, which may
  // differ from the viewer's UI language — so it travels with the report.
  return NextResponse.json({ ...report, chrome: reportChrome(lang) })
}
