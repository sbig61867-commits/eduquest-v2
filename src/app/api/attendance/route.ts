import { currentCtx } from '@/lib/auth/current'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne, type Row, type Sql } from '@/lib/db/sql'
import { staffCan } from '@/lib/staff-auth'
import { isValidSessionDate, isAttendanceStatus } from '@/lib/attendance'

// Group attendance. Allowed for the group's own teacher, or staff holding
// manage_attendance in the same tenant — decided on the caller's live row.
// Everything runs as app_service pinned to the caller's institution (the
// attendance tables have SELECT policies only for users).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_NOTE = 300
const MAX_RECORDS = 500
const ROSTER_LIMIT = 5000

type Me = { role: string; permissions: Record<string, unknown> | null }
type Group = { id: string; teacher_id: string }

/** The caller's live row and the group (live, this institution) — the two statements every call starts with. */
const gateSql = (sql: Sql, userId: string, tenantId: string, groupId: string) => [
  sql`select role, permissions from public.users where id = ${userId} and tenant_id = ${tenantId} and is_active is not false`,
  sql`select id, teacher_id from public.groups where id = ${groupId} and tenant_id = ${tenantId} and deleted_at is null`,
]

/** The gate's decision: an error response, or the role it allowed. */
type Refused = { error: Response }

async function decide(userId: string, me: Me | null, group: Group | null): Promise<Refused | { error?: undefined; role: string; staff: boolean }> {
  if (!me) return { error: NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 }) }
  if (!group) return { error: NextResponse.json({ ...(await apiErr('groupNotFound')) }, { status: 404 }) }
  const staff = me.role !== 'teacher' && staffCan(me, 'manage_attendance')
  const owner = me.role === 'teacher' && group.teacher_id === userId
  if (!staff && !owner) return { error: NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 }) }
  return { role: me.role, staff }
}

async function session(): Promise<Refused | { error?: undefined; userId: string; tenantId: string }> {
  const ctx = await currentCtx()
  if (!ctx) return { error: NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 }) }
  if (!ctx.tenant_id) return { error: NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 }) }
  return { userId: ctx.sub, tenantId: ctx.tenant_id }
}

// GET /api/attendance?group_id=…&date=YYYY-MM-DD
// ONE unit: the gate, the roster, the day's session with its records, and the
// last 10 sessions with their counts — the data is discarded unless the gate passes.
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams
  const groupId = params.get('group_id')
  const date = params.get('date')
  const s = await session()
  if (s.error) return s.error
  if (!groupId) return NextResponse.json({ ...(await apiErr('missingGroupId')) }, { status: 400 })
  if (!isValidSessionDate(date)) return NextResponse.json({ ...(await apiErr('invalidDate')) }, { status: 400 })
  if (!UUID.test(groupId)) return NextResponse.json({ ...(await apiErr('groupNotFound')) }, { status: 404 })

  let rows: Row[][]
  try {
    rows = await run({ as: 'service', tenantId: s.tenantId }, sql => [
      ...gateSql(sql, s.userId, s.tenantId, groupId),
      sql`select u.id, u.full_name, u.email, u.is_active
            from public.group_students gs join public.users u on u.id = gs.student_id
           where gs.group_id = ${groupId}
           limit ${ROSTER_LIMIT}`,
      sql`select id, title from public.attendance_sessions
           where group_id = ${groupId} and session_date = ${date}::date and schedule_slot_id is null`,
      sql`select r.student_id, r.status, r.note
            from public.attendance_records r join public.attendance_sessions a on a.id = r.session_id
           where a.group_id = ${groupId} and a.session_date = ${date}::date and a.schedule_slot_id is null`,
      sql`select a.id, a.session_date, a.title,
                 count(*) filter (where r.status = 'present')::int as present,
                 count(*) filter (where r.status = 'late')::int as late,
                 count(*) filter (where r.status = 'absent')::int as absent,
                 count(*) filter (where r.status = 'excused')::int as excused
            from public.attendance_sessions a left join public.attendance_records r on r.session_id = a.id
           where a.group_id = ${groupId}
           group by a.id
           order by a.session_date desc
           limit 10`,
    ])
  } catch (e) {
    console.error('[api/attendance GET]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('attendanceUnavailable')) }, { status: 503 })
  }

  const gate = await decide(s.userId, maybeOne<Me>(rows[0]), maybeOne<Group>(rows[1]))
  if (gate.error) return gate.error

  type U = { id: string; full_name: string; email: string; is_active: boolean }
  const roster = (rows[2] as unknown as U[]).sort((a, b) => a.full_name.localeCompare(b.full_name, 'ar'))
  const records = Object.fromEntries((rows[4] as unknown as { student_id: string; status: string; note: string | null }[])
    .map(r => [r.student_id, { status: r.status, note: r.note }]))
  return NextResponse.json({ roster, session: maybeOne(rows[3]), records, recent: rows[5] })
}

// POST /api/attendance { group_id, session_date, title?, records: [{ student_id, status, note? }] }
export async function POST(request: Request) {
  let body: { group_id?: string; session_date?: string; title?: string; records?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { group_id, session_date } = body
  if (!group_id) return NextResponse.json({ ...(await apiErr('missingGroupId')) }, { status: 400 })
  if (!isValidSessionDate(session_date)) return NextResponse.json({ ...(await apiErr('invalidDate')) }, { status: 400 })
  const title = body.title ? String(body.title).trim().slice(0, 120) : null

  if (!Array.isArray(body.records) || body.records.length === 0) {
    return NextResponse.json({ ...(await apiErr('noAttendanceRecords')) }, { status: 400 })
  }
  if (body.records.length > MAX_RECORDS) return NextResponse.json({ ...(await apiErr('tooManyRecords')) }, { status: 400 })

  const records: { student_id: string; status: string; note: string | null }[] = []
  const seen = new Set<string>()
  for (const raw of body.records as Record<string, unknown>[]) {
    const studentId = typeof raw?.student_id === 'string' ? raw.student_id : ''
    const status = typeof raw?.status === 'string' ? raw.status : ''
    const note = raw?.note ? String(raw.note).trim() : null
    if (!studentId || !isAttendanceStatus(status)) return NextResponse.json({ ...(await apiErr('invalidAttendanceRecord')) }, { status: 400 })
    if (note && note.length > MAX_NOTE) return NextResponse.json({ ...(await apiErr('noteTooLong')) }, { status: 400 })
    if (seen.has(studentId)) return NextResponse.json({ ...(await apiErr('duplicateStudent')) }, { status: 400 })
    seen.add(studentId)
    records.push({ student_id: studentId, status, note: note || null })
  }

  const s = await session()
  if (s.error) return s.error
  if (!UUID.test(group_id)) return NextResponse.json({ ...(await apiErr('groupNotFound')) }, { status: 404 })
  if (records.some(r => !UUID.test(r.student_id))) return NextResponse.json({ ...(await apiErr('studentsNotInGroup')) }, { status: 400 })

  // 1) the gate and how many of the marked students are NOT members of the group
  let gateRows: Row[][]
  try {
    gateRows = await run({ as: 'service', tenantId: s.tenantId }, sql => [
      ...gateSql(sql, s.userId, s.tenantId, group_id),
      sql`select count(*)::int as n from jsonb_to_recordset(${sql.json(records)}) as x(student_id uuid)
           where not exists (select 1 from public.group_students gs where gs.group_id = ${group_id} and gs.student_id = x.student_id)`,
    ])
  } catch (e) {
    console.error('[api/attendance POST gate]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('attendanceUnavailable')) }, { status: 503 })
  }
  const gate = await decide(s.userId, maybeOne<Me>(gateRows[0]), maybeOne<Group>(gateRows[1]))
  if (gate.error) return gate.error
  // Only students actually enrolled in this group can be marked.
  if ((maybeOne<{ n: number }>(gateRows[2])?.n ?? 0) > 0) {
    return NextResponse.json({ ...(await apiErr('studentsNotInGroup')) }, { status: 400 })
  }

  // 2) the day's session (updated or created) and its records, in one unit —
  //    only while the caller is still live with the role the gate allowed
  //    (and, for a teacher, still the group's teacher).
  const live = (sql: Sql) => sql`exists (select 1 from public.users u, public.groups g
      where u.id = ${s.userId} and u.tenant_id = ${s.tenantId} and u.is_active is not false and u.role = ${gate.role}
        and g.id = ${group_id} and g.tenant_id = ${s.tenantId} and g.deleted_at is null
        and (${gate.staff} or g.teacher_id = u.id))`
  try {
    const [sessionRows] = await run({ as: 'service', tenantId: s.tenantId }, sql => [
      sql`with ex as (
            select id from public.attendance_sessions
             where group_id = ${group_id} and session_date = ${session_date}::date and schedule_slot_id is null
          ), upd as (
            update public.attendance_sessions set title = ${title}, updated_at = now()
             where id in (select id from ex) and ${live(sql)}
            returning id
          ), ins as (
            insert into public.attendance_sessions (tenant_id, group_id, session_date, title, created_by)
            select ${s.tenantId}, ${group_id}, ${session_date}::date, ${title}, ${s.userId}
             where not exists (select 1 from ex) and ${live(sql)}
            returning id
          )
          select id from upd union all select id from ins`,
      sql`insert into public.attendance_records (session_id, tenant_id, student_id, status, note, marked_by, marked_at)
          select a.id, ${s.tenantId}, x.student_id, x.status, x.note, ${s.userId}, now()
            from jsonb_to_recordset(${sql.json(records)}) as x(student_id uuid, status text, note text)
            join public.attendance_sessions a
              on a.group_id = ${group_id} and a.session_date = ${session_date}::date and a.schedule_slot_id is null
           where ${live(sql)}
          on conflict (session_id, student_id) do update set
            status = excluded.status, note = excluded.note, marked_by = excluded.marked_by, marked_at = excluded.marked_at`,
    ])
    const saved = maybeOne<{ id: string }>(sessionRows)
    if (!saved) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
    return NextResponse.json({ session_id: saved.id, saved: records.length })
  } catch (e) {
    console.error('[api/attendance POST]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('attendanceSaveFailed')) }, { status: 500 })
  }
}

// DELETE /api/attendance { session_id }
export async function DELETE(request: Request) {
  let body: { session_id?: string }
  try { body = await request.json() } catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }
  if (!body.session_id) return NextResponse.json({ ...(await apiErr('missingSessionId')) }, { status: 400 })
  const sessionId = body.session_id

  const s = await session()
  if (s.error) return s.error
  if (!UUID.test(sessionId)) return NextResponse.json({ ...(await apiErr('sessionNotFound')) }, { status: 404 })

  // 1) the session (this institution's), the caller and the session's group
  let rows: Row[][]
  try {
    rows = await run({ as: 'service', tenantId: s.tenantId }, sql => [
      sql`select role, permissions from public.users where id = ${s.userId} and tenant_id = ${s.tenantId} and is_active is not false`,
      sql`select g.id, g.teacher_id from public.attendance_sessions a join public.groups g on g.id = a.group_id
           where a.id = ${sessionId} and a.tenant_id = ${s.tenantId} and g.deleted_at is null`,
    ])
  } catch (e) {
    console.error('[api/attendance DELETE]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('sessionDeleteFailed')) }, { status: 500 })
  }
  const group = maybeOne<Group>(rows[1])
  if (!group) return NextResponse.json({ ...(await apiErr('sessionNotFound')) }, { status: 404 })
  const gate = await decide(s.userId, maybeOne<Me>(rows[0]), group)
  if (gate.error) return gate.error

  // 2) the delete, repeating the live check
  try {
    await run({ as: 'service', tenantId: s.tenantId }, sql => [
      sql`delete from public.attendance_sessions a
           where a.id = ${sessionId} and a.tenant_id = ${s.tenantId}
             and exists (select 1 from public.users u, public.groups g
                          where u.id = ${s.userId} and u.tenant_id = ${s.tenantId} and u.is_active is not false and u.role = ${gate.role}
                            and g.id = a.group_id and (${gate.staff} or g.teacher_id = u.id))`,
    ])
  } catch (e) {
    console.error('[api/attendance DELETE]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('sessionDeleteFailed')) }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
