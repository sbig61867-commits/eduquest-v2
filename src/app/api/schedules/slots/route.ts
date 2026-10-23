import { apiErr, type ApiErrorCode } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne, type Row, type Sql } from '@/lib/db/sql'
import { getCaller, staffCan, type StaffCaller } from '@/lib/staff-auth'

// Individual timetable entries. Same authorization model as /api/schedules:
// `manage_schedules` checked on the caller's live row, and every write ONE
// unit as app_service pinned to the caller's institution that re-verifies the
// schedule / slot and the slot's teacher belong to it.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/

async function authorize(): Promise<{ caller: StaffCaller } | { error: NextResponse }> {
  const res = await getCaller()
  if ('error' in res) return res
  if (!staffCan(res.caller, 'manage_schedules')) {
    return { error: NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 }) }
  }
  return res
}

const liveCaller = (sql: Sql, c: StaffCaller) =>
  sql`exists (select 1 from public.users where id = ${c.id} and tenant_id = ${c.tenant_id} and is_active is not false and role = ${c.role})`

interface SlotFields {
  title?: string; day_of_week?: number; start_time?: string; end_time?: string
  location?: string | null; note?: string | null; teacher_id?: string | null
}

/** Shared field validation for POST and PATCH. */
function readSlotFields(body: Record<string, unknown>, partial: boolean): { error: ApiErrorCode } | { fields: SlotFields } {
  const out: SlotFields = {}

  if (!partial || body.title !== undefined) {
    const title = String(body.title ?? '').trim()
    if (!title) return { error: 'slotTitleRequired' }
    out.title = title
  }
  if (!partial || body.day_of_week !== undefined) {
    const day = Number(body.day_of_week)
    if (!Number.isInteger(day) || day < 0 || day > 6) return { error: 'invalidDay' }
    out.day_of_week = day
  }
  if (!partial || body.start_time !== undefined) {
    const t = String(body.start_time ?? '')
    if (!TIME_RE.test(t)) return { error: 'invalidStartTime' }
    out.start_time = t
  }
  if (!partial || body.end_time !== undefined) {
    const t = String(body.end_time ?? '')
    if (!TIME_RE.test(t)) return { error: 'invalidEndTime' }
    out.end_time = t
  }
  for (const f of ['location', 'note'] as const) {
    if (body[f] !== undefined) out[f] = body[f] ? String(body[f]).trim() : null
  }
  if (body.teacher_id !== undefined) {
    const t = body.teacher_id ? String(body.teacher_id) : null
    if (t && !UUID.test(t)) return { error: 'invalidTeacher' }
    out.teacher_id = t
  }

  // Only comparable when both ends are present (always true on POST).
  if (out.start_time && out.end_time && out.end_time <= out.start_time) return { error: 'endTimeBeforeStart' }
  return { fields: out }
}

/** A slot's teacher (if any) is a teacher of the same institution. */
const teacherOk = (sql: Sql, tenantId: string, teacherId: string | null | undefined) => teacherId
  ? sql`exists (select 1 from public.users where id = ${teacherId} and tenant_id = ${tenantId} and role = 'teacher')`
  : sql`true`

export async function POST(request: Request) {
  const auth = await authorize()
  if ('error' in auth) return auth.error
  const { caller } = auth

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const scheduleId = String(body.schedule_id ?? '')
  if (!scheduleId) return NextResponse.json({ ...(await apiErr('missingScheduleId')) }, { status: 400 })
  const parsed = readSlotFields(body, false)
  if ('error' in parsed) return NextResponse.json({ ...(await apiErr(parsed.error)) }, { status: 400 })
  if (!UUID.test(scheduleId)) return NextResponse.json({ ...(await apiErr('scheduleNotFound')) }, { status: 404 })
  const f = parsed.fields

  try {
    const [schedule, created] = await run({ as: 'service', tenantId: caller.tenant_id }, sql => [
      sql`select id from public.schedules where id = ${scheduleId} and tenant_id = ${caller.tenant_id}`,
      sql`insert into public.schedule_slots (schedule_id, tenant_id, title, day_of_week, start_time, end_time, location, note, teacher_id)
          select s.id, ${caller.tenant_id}, ${f.title!}, ${f.day_of_week!}, ${f.start_time!}::time, ${f.end_time!}::time,
                 ${f.location ?? null}, ${f.note ?? null}, ${f.teacher_id ?? null}
            from public.schedules s
           where s.id = ${scheduleId} and s.tenant_id = ${caller.tenant_id}
             and ${teacherOk(sql, caller.tenant_id, f.teacher_id)} and ${liveCaller(sql, caller)}
          returning id`,
    ])
    const row = maybeOne<{ id: string }>(created)
    if (row) return NextResponse.json({ id: row.id }, { status: 201 })
    if (!maybeOne(schedule)) return NextResponse.json({ ...(await apiErr('scheduleNotFound')) }, { status: 404 })
    return NextResponse.json({ ...(await apiErr('invalidTeacher')) }, { status: 400 })
  } catch (e) {
    console.error('[api/schedules/slots POST]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('slotAddFailed')) }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const auth = await authorize()
  if ('error' in auth) return auth.error
  const { caller } = auth

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const id = String(body.id ?? '')
  if (!id) return NextResponse.json({ ...(await apiErr('missingId')) }, { status: 400 })
  const parsed = readSlotFields(body, true)
  if ('error' in parsed) return NextResponse.json({ ...(await apiErr(parsed.error)) }, { status: 400 })
  if (!UUID.test(id)) return NextResponse.json({ ...(await apiErr('slotNotFound')) }, { status: 404 })
  const f = parsed.fields
  const set = (k: keyof SlotFields) => k in f

  // One unit: the slot as it stands (for a precise refusal), then the update —
  // which keeps the end after the start (against the stored values when only
  // one end moves) and checks the teacher, all in the same statement.
  try {
    const [existingRows, updated] = await run({ as: 'service', tenantId: caller.tenant_id }, sql => [
      sql`select start_time, end_time from public.schedule_slots where id = ${id} and tenant_id = ${caller.tenant_id}`,
      sql`update public.schedule_slots s set
            title = coalesce(${f.title ?? null}::text, s.title),
            day_of_week = coalesce(${f.day_of_week ?? null}::int, s.day_of_week),
            start_time = coalesce(${f.start_time ?? null}::time, s.start_time),
            end_time = coalesce(${f.end_time ?? null}::time, s.end_time),
            location = case when ${set('location')} then ${f.location ?? null}::text else s.location end,
            note = case when ${set('note')} then ${f.note ?? null}::text else s.note end,
            teacher_id = case when ${set('teacher_id')} then ${f.teacher_id ?? null}::uuid else s.teacher_id end
          where s.id = ${id} and s.tenant_id = ${caller.tenant_id}
            and coalesce(${f.end_time ?? null}::time, s.end_time) > coalesce(${f.start_time ?? null}::time, s.start_time)
            and ${teacherOk(sql, caller.tenant_id, f.teacher_id)} and ${liveCaller(sql, caller)}
          returning s.id`,
    ])
    if (maybeOne<Row>(updated)) return NextResponse.json({ success: true })
    const existing = maybeOne<{ start_time: string; end_time: string }>(existingRows)
    if (!existing) return NextResponse.json({ ...(await apiErr('slotNotFound')) }, { status: 404 })
    const start = String(f.start_time ?? existing.start_time).slice(0, 5)
    const end = String(f.end_time ?? existing.end_time).slice(0, 5)
    if (end <= start) return NextResponse.json({ ...(await apiErr('endTimeBeforeStart')) }, { status: 400 })
    return NextResponse.json({ ...(await apiErr('invalidTeacher')) }, { status: 400 })
  } catch (e) {
    console.error('[api/schedules/slots PATCH]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('slotUpdateFailed')) }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const auth = await authorize()
  if ('error' in auth) return auth.error
  const { caller } = auth

  let body: { id?: string }
  try { body = await request.json() } catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }
  if (!body.id) return NextResponse.json({ ...(await apiErr('missingId')) }, { status: 400 })
  const id = body.id
  if (!UUID.test(id)) return NextResponse.json({ ...(await apiErr('slotNotFound')) }, { status: 404 })

  try {
    const [rows] = await run({ as: 'service', tenantId: caller.tenant_id }, sql => [
      sql`delete from public.schedule_slots where id = ${id} and tenant_id = ${caller.tenant_id} and ${liveCaller(sql, caller)} returning id`,
    ])
    if (!maybeOne<Row>(rows)) return NextResponse.json({ ...(await apiErr('slotNotFound')) }, { status: 404 })
  } catch (e) {
    console.error('[api/schedules/slots DELETE]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('slotDeleteFailed')) }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
