import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne, type Row, type Sql } from '@/lib/db/sql'
import { getCaller, staffCan, type StaffCaller } from '@/lib/staff-auth'

// Weekly timetables. Authoring is gated by the `manage_schedules` capability
// (university_admin / center_manager, or super_admin), checked on the caller's
// live row; each write is ONE unit as app_service pinned to the caller's
// institution — a side read for a precise refusal, and the write itself,
// which repeats the institution and live-caller checks.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function authorize(): Promise<{ caller: StaffCaller } | { error: NextResponse }> {
  const res = await getCaller()
  if ('error' in res) return res
  if (!staffCan(res.caller, 'manage_schedules')) {
    return { error: NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 }) }
  }
  return res
}

/** The caller is still live in this institution with the role checked. */
const liveCaller = (sql: Sql, c: StaffCaller) =>
  sql`exists (select 1 from public.users where id = ${c.id} and tenant_id = ${c.tenant_id} and is_active is not false and role = ${c.role})`

// POST — create a timetable for one group, or a private one for one teacher
export async function POST(request: Request) {
  const auth = await authorize()
  if ('error' in auth) return auth.error
  const { caller } = auth

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const kind = body.kind === 'teacher' ? 'teacher' : 'group'
  const targetId = String(body.target_id ?? '')
  const title = String(body.title ?? '').trim()
  if (!targetId) return NextResponse.json({ ...(await apiErr('chooseGroupOrTeacher')) }, { status: 400 })
  if (!title) return NextResponse.json({ ...(await apiErr('scheduleTitleRequired')) }, { status: 400 })
  const notFound = kind === 'group' ? 'groupNotFound' : 'teacherNotFound'
  if (!UUID.test(targetId)) return NextResponse.json({ ...(await apiErr(notFound)) }, { status: 404 })

  // The target must live in the caller's tenant — and for a private
  // timetable it must actually be a teacher — checked inside the insert.
  try {
    const [rows] = await run({ as: 'service', tenantId: caller.tenant_id }, sql => [
      sql`insert into public.schedules (tenant_id, created_by, kind, group_id, teacher_id, title, is_published)
          select ${caller.tenant_id}, ${caller.id}, ${kind}, ${kind === 'group' ? targetId : null}, ${kind === 'teacher' ? targetId : null},
                 ${title}, false
           where ${liveCaller(sql, caller)}
             and ${kind === 'group'
               ? sql`exists (select 1 from public.groups where id = ${targetId} and tenant_id = ${caller.tenant_id})`
               : sql`exists (select 1 from public.users where id = ${targetId} and tenant_id = ${caller.tenant_id} and role = 'teacher')`}
          returning id`,
    ])
    const created = maybeOne<{ id: string }>(rows)
    if (!created) return NextResponse.json({ ...(await apiErr(notFound)) }, { status: 404 })
    return NextResponse.json({ id: created.id }, { status: 201 })
  } catch (e) {
    // Partial unique index: one timetable per group / per teacher.
    if ((e as { code?: string }).code === '23505') {
      return NextResponse.json({ ...(await apiErr('scheduleExists')) }, { status: 409 })
    }
    console.error('[api/schedules POST]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('scheduleCreateFailed')) }, { status: 500 })
  }
}

// PATCH — rename or publish/unpublish
export async function PATCH(request: Request) {
  const auth = await authorize()
  if ('error' in auth) return auth.error
  const { caller } = auth

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const id = String(body.id ?? '')
  if (!id) return NextResponse.json({ ...(await apiErr('missingId')) }, { status: 400 })
  let title: string | null = null
  if (body.title !== undefined) {
    title = String(body.title).trim()
    if (!title) return NextResponse.json({ ...(await apiErr('scheduleTitleRequired')) }, { status: 400 })
  }
  const published = body.is_published !== undefined ? body.is_published === true : null
  if (!UUID.test(id)) return NextResponse.json({ ...(await apiErr('scheduleNotFound')) }, { status: 404 })

  try {
    const [rows] = await run({ as: 'service', tenantId: caller.tenant_id }, sql => [
      sql`update public.schedules set
            updated_at = now(), title = coalesce(${title}::text, title), is_published = coalesce(${published}::boolean, is_published)
          where id = ${id} and tenant_id = ${caller.tenant_id} and ${liveCaller(sql, caller)}
          returning id`,
    ])
    if (!maybeOne<Row>(rows)) return NextResponse.json({ ...(await apiErr('scheduleNotFound')) }, { status: 404 })
  } catch (e) {
    console.error('[api/schedules PATCH]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('scheduleUpdateFailed')) }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}

// DELETE — remove a timetable (slots cascade)
export async function DELETE(request: Request) {
  const auth = await authorize()
  if ('error' in auth) return auth.error
  const { caller } = auth

  let body: { id?: string }
  try { body = await request.json() } catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }
  if (!body.id) return NextResponse.json({ ...(await apiErr('missingId')) }, { status: 400 })
  const id = body.id
  if (!UUID.test(id)) return NextResponse.json({ ...(await apiErr('scheduleNotFound')) }, { status: 404 })

  try {
    const [rows] = await run({ as: 'service', tenantId: caller.tenant_id }, sql => [
      sql`delete from public.schedules where id = ${id} and tenant_id = ${caller.tenant_id} and ${liveCaller(sql, caller)} returning id`,
    ])
    if (!maybeOne<Row>(rows)) return NextResponse.json({ ...(await apiErr('scheduleNotFound')) }, { status: 404 })
  } catch (e) {
    console.error('[api/schedules DELETE]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('scheduleDeleteFailed')) }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
