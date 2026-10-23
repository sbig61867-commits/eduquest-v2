import { currentCtx } from '@/lib/auth/current'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne, type Row } from '@/lib/db/sql'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// GET /api/surveys/respond — student: the open survey (if any) of one of their
// ACTIVE groups that they haven't answered yet. One statement, as app_service
// pinned to the student's institution (an archived group and its survey are
// hidden from students).
export async function GET() {
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  if (ctx.role !== 'student' || !ctx.tenant_id) return NextResponse.json({ survey: null })

  try {
    const [rows] = await run({ as: 'service', tenantId: ctx.tenant_id }, sql => [
      sql`select s.id, s.title, g.name as group_name
            from public.group_students gs
            join public.groups g on g.id = gs.group_id and g.is_active
            join public.surveys s on s.group_id = g.id and s.is_open
           where gs.student_id = ${ctx.sub}
             and not exists (select 1 from public.survey_responses r where r.survey_id = s.id and r.student_id = ${ctx.sub})
           order by s.created_at
           limit 1`,
    ])
    const pending = maybeOne<{ id: string; title: string; group_name: string | null }>(rows)
    return NextResponse.json({ survey: pending ? { id: pending.id, title: pending.title, groupName: pending.group_name ?? '' } : null })
  } catch (e) {
    console.error('[surveys/respond GET]', e instanceof Error ? e.message : e)
    return NextResponse.json({ survey: null })
  }
}

// POST /api/surveys/respond — student submits their one answer
// Body: { survey_id, ease_rating, prefer_platform, best_feature, problem_faced, recommend, comment }
export async function POST(request: Request) {
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  if (ctx.role !== 'student' || !ctx.tenant_id) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  const tenantId = ctx.tenant_id

  let body: {
    survey_id?: string; ease_rating?: number; prefer_platform?: boolean
    best_feature?: string; problem_faced?: string; recommend?: boolean; comment?: string
  }
  try { body = await request.json() } catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { survey_id, ease_rating, prefer_platform, recommend } = body
  if (!survey_id || typeof ease_rating !== 'number' || ease_rating < 1 || ease_rating > 5
      || typeof prefer_platform !== 'boolean' || typeof recommend !== 'boolean') {
    return NextResponse.json({ ...(await apiErr('missingOrInvalidFields')) }, { status: 400 })
  }
  if (!UUID.test(survey_id)) return NextResponse.json({ ...(await apiErr('surveyNotOpen')) }, { status: 404 })

  // One unit: the survey as it stands and the membership (for a precise
  // refusal), then the answer — written only while the survey is open, its
  // group not archived, and the caller a live student of that group.
  let rows: Row[][]
  try {
    rows = await run({ as: 'service', tenantId }, sql => [
      sql`select s.is_open, g.is_active,
                 exists (select 1 from public.group_students gs where gs.group_id = s.group_id and gs.student_id = ${ctx.sub}) as member
            from public.surveys s join public.groups g on g.id = s.group_id
           where s.id = ${survey_id} and s.tenant_id = ${tenantId}`,
      sql`insert into public.survey_responses (survey_id, student_id, tenant_id, ease_rating, prefer_platform, best_feature,
                                               problem_faced, recommend, comment)
          select s.id, ${ctx.sub}, ${tenantId}, ${ease_rating}, ${prefer_platform},
                 ${body.best_feature?.trim().slice(0, 500) || null}, ${body.problem_faced?.trim().slice(0, 500) || null},
                 ${recommend}, ${body.comment?.trim().slice(0, 1000) || null}
            from public.surveys s join public.groups g on g.id = s.group_id
           where s.id = ${survey_id} and s.tenant_id = ${tenantId} and s.is_open and g.is_active is not false
             and exists (select 1 from public.group_students gs where gs.group_id = s.group_id and gs.student_id = ${ctx.sub})
             and exists (select 1 from public.users u where u.id = ${ctx.sub} and u.tenant_id = ${tenantId}
                           and u.role = 'student' and u.is_active is not false)
          returning id`,
    ])
  } catch (e) {
    if ((e as { code?: string }).code === '23505') return NextResponse.json({ ...(await apiErr('alreadySubmitted')) }, { status: 409 })
    console.error('[surveys/respond POST]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('answerSendFailed')) }, { status: 500 })
  }
  if (maybeOne(rows[1])) return NextResponse.json({ ok: true }, { status: 201 })

  const s = maybeOne<{ is_open: boolean; is_active: boolean | null; member: boolean }>(rows[0])
  if (!s || !s.is_open || s.is_active === false) return NextResponse.json({ ...(await apiErr('surveyNotOpen')) }, { status: 404 })
  return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
}
