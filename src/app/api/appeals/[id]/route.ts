import { currentCtx } from '@/lib/auth/current'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne } from '@/lib/db/sql'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RESOLUTIONS = new Set(['upheld', 'rejected'])

// PATCH /api/appeals/[id] — the exam's teacher (or an admin in the same
// tenant) resolves an appeal. Body: { status: 'upheld' | 'rejected', response }
// 'upheld' means the teacher agrees the violation was wrong; the caller is
// responsible for separately correcting the submission record if needed —
// this endpoint only records the resolution, it does not mutate
// proctoring_events (that array is the append-only audit trail; editing it
// after the fact would undermine its own purpose as evidence).
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const user = { id: ctx.sub }
  if (!ctx.tenant_id) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })

  let body: { status?: string; response?: string }
  try { body = await request.json() } catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const status = body.status
  const response = body.response?.trim()
  if (!status || !RESOLUTIONS.has(status)) {
    return NextResponse.json({ ...(await apiErr('invalidStatus')) }, { status: 400 })
  }
  if (!response || response.length < 3) {
    return NextResponse.json({ ...(await apiErr('responseRequired')) }, { status: 400 })
  }
  if (!UUID.test(id)) return NextResponse.json({ ...(await apiErr('appealNotFound')) }, { status: 404 })

  // One unit, as app_service pinned to the caller's institution: the appeal
  // as it stands (for a precise refusal), then the resolution, written ONLY
  // while it is pending (race guard) and when the caller — checked live — is
  // its teacher or an admin of that institution.
  let rows: Awaited<ReturnType<typeof run>>
  try {
    rows = await run({ as: 'service', tenantId: ctx.tenant_id }, sql => [
      sql`select teacher_id, status from public.exam_appeals where id = ${id}`,
      sql`
        with me as (
          select id, role, tenant_id from public.users where id = ${user.id} and is_active is not false
        )
        update public.exam_appeals a
           set status = ${status}, teacher_response = ${response}, resolved_by = me.id, resolved_at = now()
          from me
         where a.id = ${id} and a.status = 'pending' and a.tenant_id = me.tenant_id
           and (a.teacher_id = me.id or me.role in ('university_admin', 'super_admin'))
        returning a.id`,
    ])
  } catch (e) {
    console.error('[api/appeals PATCH]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('decisionSaveFailed')) }, { status: 500 })
  }
  if (maybeOne(rows[1])) return NextResponse.json({ ok: true, status })

  // Nothing was written: say why.
  const appeal = maybeOne<{ teacher_id: string; status: string }>(rows[0])
  if (!appeal) return NextResponse.json({ ...(await apiErr('appealNotFound')) }, { status: 404 })
  const isAdmin = ctx.role === 'university_admin' || ctx.role === 'super_admin'
  if (appeal.teacher_id !== user.id && !isAdmin) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  if (appeal.status !== 'pending') return NextResponse.json({ ...(await apiErr('appealDecided')) }, { status: 409 })
  return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
}
