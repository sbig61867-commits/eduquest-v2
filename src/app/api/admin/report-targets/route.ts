import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { REPORT_TARGET_KINDS, searchReportTargets, type ReportTargetKind } from '@/lib/data/report-targets'
import { sanitizeSearch } from '@/lib/data/people'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// GET /api/admin/report-targets?kind=teacher|student|group&tenant_id=…&q=…
// The entity picker of /super-admin/reports (R1): at most 20 teachers, students
// or groups of ONE institution matching q (src/lib/data/report-targets.ts).
// Owner only — the same check as the page itself (role read from the database
// with the caller's session, not trusted from the client). The search runs on
// that session, so RLS stays the boundary; the report itself is still produced
// and authorized by /api/reports, unchanged.
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (profile?.role !== 'super_admin') return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })

  const params = new URL(request.url).searchParams
  const kind = params.get('kind') as ReportTargetKind | null
  const tenantId = params.get('tenant_id') ?? ''
  if (!kind || !REPORT_TARGET_KINDS.includes(kind)) {
    return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
  }
  if (!UUID_RE.test(tenantId)) return NextResponse.json({ ...(await apiErr('tenantIdRequired')) }, { status: 400 })
  const q = sanitizeSearch(params.get('q'))
  if (!q) return NextResponse.json({ ...(await apiErr('searchQueryRequired')) }, { status: 400 })

  const { rows, error } = await searchReportTargets(supabase, tenantId, kind, q)
  if (error) {
    console.error('[admin/report-targets]', error)
    return NextResponse.json({ ...(await apiErr('usersLoadFailed')) }, { status: 500 })
  }
  return NextResponse.json({ results: rows })
}
