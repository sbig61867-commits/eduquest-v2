import { currentCtx } from '@/lib/auth/current'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne, type Row, type Sql } from '@/lib/db/sql'

// The pilot survey of a group (one per group). Allowed for the group's own
// teacher, or an institution admin / the owner in the same institution. Each
// call is ONE unit as app_service pinned to the caller's institution: the
// caller's live row and the group (for a precise refusal) and the read or
// write itself, which repeats the same conditions.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ROLES = ['teacher', 'university_admin', 'super_admin']

const gateSql = (sql: Sql, userId: string, tenantId: string, groupId: string) => [
  sql`select role from public.users where id = ${userId} and tenant_id = ${tenantId} and is_active is not false`,
  sql`select teacher_id from public.groups where id = ${groupId} and tenant_id = ${tenantId}`,
]

/** The caller may manage this group's survey (live row, same institution, own group for a teacher). */
const allowed = (sql: Sql, userId: string, tenantId: string, groupId: string) => sql`exists (
  select 1 from public.users u, public.groups g
   where u.id = ${userId} and u.tenant_id = ${tenantId} and u.is_active is not false
     and u.role in ('teacher', 'university_admin', 'super_admin')
     and g.id = ${groupId} and g.tenant_id = ${tenantId}
     and (u.role <> 'teacher' or g.teacher_id = u.id))`

async function refusal(userId: string, me: { role: string } | null, group: { teacher_id: string } | null) {
  if (!me || !ROLES.includes(me.role)) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  if (!group) return NextResponse.json({ ...(await apiErr('groupNotFound')) }, { status: 404 })
  if (me.role === 'teacher' && group.teacher_id !== userId) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  return null
}

async function caller() {
  const ctx = await currentCtx()
  if (!ctx) return { error: NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 }) }
  if (!ctx.tenant_id || !ROLES.includes(ctx.role ?? '')) return { error: NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 }) }
  return { userId: ctx.sub, tenantId: ctx.tenant_id }
}

// GET /api/surveys?group_id=xxx — teacher/admin view: survey + response count
export async function GET(request: Request) {
  const c = await caller()
  if (c.error) return c.error
  const groupId = new URL(request.url).searchParams.get('group_id')
  if (!groupId) return NextResponse.json({ ...(await apiErr('missingGroupId')) }, { status: 400 })
  if (!UUID.test(groupId)) return NextResponse.json({ ...(await apiErr('groupNotFound')) }, { status: 404 })

  let rows: Row[][]
  try {
    rows = await run({ as: 'service', tenantId: c.tenantId }, sql => [
      ...gateSql(sql, c.userId, c.tenantId, groupId),
      sql`select s.id, s.title, s.is_open, s.created_at,
                 (select count(*) from public.survey_responses r where r.survey_id = s.id)::int as response_count
            from public.surveys s where s.group_id = ${groupId} and s.tenant_id = ${c.tenantId}`,
      sql`select count(*)::int as n from public.group_students where group_id = ${groupId}`,
    ])
  } catch (e) {
    console.error('[surveys GET]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('unexpected')) }, { status: 500 })
  }
  const refused = await refusal(c.userId, maybeOne(rows[0]), maybeOne(rows[1]))
  if (refused) return refused
  const s = maybeOne<{ id: string; title: string; is_open: boolean; created_at: string; response_count: number }>(rows[2])
  const survey = s ? { id: s.id, title: s.title, is_open: s.is_open, created_at: s.created_at } : null
  return NextResponse.json({ survey, responseCount: s?.response_count ?? 0, memberCount: maybeOne<{ n: number }>(rows[3])?.n ?? 0 })
}

// POST /api/surveys — create (or reopen) the survey of a group. Body: { group_id }
export async function POST(request: Request) {
  const c = await caller()
  if (c.error) return c.error
  let body: { group_id?: string }
  try { body = await request.json() } catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }
  const groupId = body.group_id
  if (!groupId) return NextResponse.json({ ...(await apiErr('missingGroupId')) }, { status: 400 })
  if (!UUID.test(groupId)) return NextResponse.json({ ...(await apiErr('groupNotFound')) }, { status: 404 })

  try {
    const rows = await run({ as: 'service', tenantId: c.tenantId }, sql => [
      ...gateSql(sql, c.userId, c.tenantId, groupId),
      sql`insert into public.surveys (group_id, tenant_id, teacher_id, is_open)
          select g.id, g.tenant_id, g.teacher_id, true from public.groups g
           where g.id = ${groupId} and ${allowed(sql, c.userId, c.tenantId, groupId)}
          on conflict (group_id) do update set tenant_id = excluded.tenant_id, teacher_id = excluded.teacher_id, is_open = true
          returning id, title, is_open, created_at`,
    ])
    const survey = maybeOne(rows[2])
    if (survey) return NextResponse.json({ survey }, { status: 201 })
    return (await refusal(c.userId, maybeOne(rows[0]), maybeOne(rows[1])))
      ?? NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  } catch (e) {
    console.error('[surveys POST]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('surveyCreateFailed')) }, { status: 500 })
  }
}

// PATCH /api/surveys — toggle open/closed. Body: { group_id, is_open }
export async function PATCH(request: Request) {
  const c = await caller()
  if (c.error) return c.error
  let body: { group_id?: string; is_open?: boolean }
  try { body = await request.json() } catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }
  const { group_id: groupId, is_open } = body
  if (!groupId || typeof is_open !== 'boolean') return NextResponse.json({ ...(await apiErr('missingGroupOrOpen')) }, { status: 400 })
  if (!UUID.test(groupId)) return NextResponse.json({ ...(await apiErr('groupNotFound')) }, { status: 404 })

  try {
    const rows = await run({ as: 'service', tenantId: c.tenantId }, sql => [
      ...gateSql(sql, c.userId, c.tenantId, groupId),
      sql`update public.surveys set is_open = ${is_open}
           where group_id = ${groupId} and tenant_id = ${c.tenantId} and ${allowed(sql, c.userId, c.tenantId, groupId)}
          returning id, title, is_open, created_at`,
    ])
    const survey = maybeOne(rows[2])
    if (survey) return NextResponse.json({ survey })
    return (await refusal(c.userId, maybeOne(rows[0]), maybeOne(rows[1])))
      ?? NextResponse.json({ ...(await apiErr('surveyUpdateFailed')) }, { status: 500 })
  } catch (e) {
    console.error('[surveys PATCH]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('surveyUpdateFailed')) }, { status: 500 })
  }
}
