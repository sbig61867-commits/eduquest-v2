import { currentCtx } from '@/lib/auth/current'
import { normalizeSebKey } from '@/lib/seb'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne, type Row } from '@/lib/db/sql'
import type { Question } from '@/types'
import { deleteEntityAs } from '@/lib/delete-entity'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const MIN_EXAM_MINUTES = 1
const MAX_EXAM_MINUTES = 600
// A course task (kind 'homework') is untimed: the database still needs a duration.
const HOMEWORK_MINUTES = 43200

function validDuration(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null
  if (n < MIN_EXAM_MINUTES || n > MAX_EXAM_MINUTES) return null
  return n
}

// The institution scope comes from the session context. Every write below
// still checks the caller against the LIVE row: the insert joins `me` (role,
// institution, active), and updates/deletes require teacher_id = the caller in
// that institution. A demoted or moved account therefore gains nothing from a
// context that is up to 15 minutes old; the proxy re-checks is_active live
// before any write.

export async function POST(request: Request) {
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const user = { id: ctx.sub }

  let body: {
    title?: string; group_id?: string; course_id?: string; kind?: 'exam' | 'homework'
    duration_minutes?: number; proctoring_enabled?: boolean; questions?: Question[]; due_date?: string | null
    /** Optional SEB Config Key (64 hex). */
    seb_config_key?: string | null
  }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { title, group_id, course_id, duration_minutes, proctoring_enabled, questions, due_date } = body
  // SEB is for proctored exams only; a malformed key is refused, not ignored.
  const sebRaw = typeof body.seb_config_key === 'string' ? body.seb_config_key.trim() : ''
  const sebKey = sebRaw ? normalizeSebKey(sebRaw) : null
  if (sebRaw && !sebKey) return NextResponse.json({ ...(await apiErr('sebKeyInvalid')) }, { status: 400 })
  // An exam belongs to exactly one group OR one course (DB CHECK
  // exam_must_belong_to_group_or_course). Group homework is created from its
  // lesson through /api/homework, so 'homework' here is a course task only.
  const kind = body.kind ?? 'exam'
  if (!title?.trim() || (!group_id === !course_id) || (kind !== 'exam' && kind !== 'homework') || (kind === 'homework' && !course_id)) {
    return NextResponse.json({ ...(await apiErr('titleAndGroupRequired')) }, { status: 400 })
  }
  const targetId = (group_id ?? course_id) as string
  if (!UUID.test(targetId)) {
    return NextResponse.json({ ...(await apiErr(group_id ? 'groupNotFound' : 'courseNotFound')) }, { status: 404 })
  }

  const minutes = kind === 'homework' ? HOMEWORK_MINUTES : duration_minutes === undefined ? 60 : validDuration(duration_minutes)
  if (minutes === null) {
    return NextResponse.json(
      { ...(await apiErr('examDurationRange', { min: MIN_EXAM_MINUTES, max: MAX_EXAM_MINUTES })) },
      { status: 400 }
    )
  }
  const dueAt = kind === 'homework' && due_date ? new Date(due_date) : null
  if (dueAt && Number.isNaN(dueAt.getTime())) {
    return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
  }

  if (!ctx.tenant_id || !['teacher', 'university_admin', 'super_admin'].includes(ctx.role ?? '')) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }
  const tenantId = ctx.tenant_id

  // One unit, as app_service pinned to the caller's institution:
  //  1. the target as it stands (for a precise refusal: not found vs not yours)
  //  2. the insert itself, which happens ONLY when the target is live, in this
  //     institution and — for a teacher — their own, and the caller's live role
  //     still allows it; it returns the new exam with its group/course name.
  const proctored = kind === 'exam' ? (proctoring_enabled ?? false) : false
  const seb = sebKey && kind === 'exam' && proctoring_enabled ? sebKey : null
  const [targetRows, createdRows] = await run({ as: 'service', tenantId }, sql => [
    group_id
      ? sql`select teacher_id, tenant_id, null::timestamptz as deleted_at from public.groups where id = ${targetId}`
      : sql`select teacher_id, tenant_id, deleted_at from public.courses where id = ${targetId}`,
    sql`
      with me as (
        select role, tenant_id from public.users where id = ${user.id} and is_active is not false
      ), target as (
        ${group_id
          ? sql`select id, teacher_id, tenant_id from public.groups where id = ${targetId}`
          : sql`select id, teacher_id, tenant_id from public.courses where id = ${targetId} and deleted_at is null`}
      ), ins as (
        insert into public.exams (type, title, group_id, course_id, teacher_id, tenant_id, duration_minutes,
                                  proctoring_enabled, ends_at, questions, seb_config_key)
        select ${kind}, ${title.trim()}, ${group_id ?? null}, ${course_id ?? null}, ${user.id}, me.tenant_id, ${minutes},
               ${proctored}, ${dueAt ? dueAt.toISOString() : null}, ${sql.json((questions ?? []) as unknown as Parameters<typeof sql.json>[0])}, ${seb}
          from me, target
         where target.tenant_id = me.tenant_id
           and me.role in ('teacher', 'university_admin', 'super_admin')
           and (me.role <> 'teacher' or target.teacher_id = ${user.id})
        returning *
      )
      select ins.*,
             case when g.id is null then null else json_build_object('name', g.name) end as groups,
             case when c.id is null then null else json_build_object('title', c.title) end as courses
        from ins
        left join public.groups g on g.id = ins.group_id
        left join public.courses c on c.id = ins.course_id`,
  ])

  const created = maybeOne<Row>(createdRows)
  if (created) return NextResponse.json(created, { status: 201 })

  // Nothing was written: say why.
  const owner = maybeOne<{ teacher_id: string | null; tenant_id: string; deleted_at: string | null }>(targetRows)
  if (!owner || owner.tenant_id !== tenantId || owner.deleted_at) {
    return NextResponse.json({ ...(await apiErr(group_id ? 'groupNotFound' : 'courseNotFound')) }, { status: 404 })
  }
  return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
}

export async function PATCH(request: Request) {
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const user = { id: ctx.sub }

  let body: { id?: string; is_published?: boolean; title?: string; duration_minutes?: number }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { id, ...rest } = body
  if (!id) return NextResponse.json({ ...(await apiErr('missingId')) }, { status: 400 })
  if (!UUID.test(id)) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })

  if (!ctx.tenant_id) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  const profile = { tenant_id: ctx.tenant_id }

  if (rest.title !== undefined && (typeof rest.title !== 'string' || !rest.title.trim())) {
    return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
  }
  let minutes: number | null = null
  if (rest.duration_minutes !== undefined) {
    minutes = validDuration(rest.duration_minutes)
    if (minutes === null) {
      return NextResponse.json(
        { ...(await apiErr('examDurationRange', { min: MIN_EXAM_MINUTES, max: MAX_EXAM_MINUTES })) },
        { status: 400 }
      )
    }
  }

  // One unit: the exam as it stands (ownership and kind), then the update,
  // which touches the row only when it is this teacher's, in this institution,
  // and — for a duration change — not homework (edited from its lesson).
  const [examRows, updatedRows] = await run({ as: 'service', tenantId: profile.tenant_id }, sql => [
    sql`select teacher_id, type from public.exams where id = ${id}`,
    sql`
      with upd as (
        update public.exams set
          is_published = coalesce(${rest.is_published ?? null}::boolean, is_published),
          title = coalesce(${rest.title ?? null}::text, title),
          duration_minutes = coalesce(${minutes}::int, duration_minutes)
         where id = ${id} and teacher_id = ${user.id} and tenant_id = ${profile.tenant_id}
           and (${minutes}::int is null or type <> 'homework')
        returning *
      )
      select upd.*, case when g.id is null then null else json_build_object('name', g.name) end as groups
        from upd left join public.groups g on g.id = upd.group_id`,
  ])

  const exam = maybeOne<{ teacher_id: string; type: string }>(examRows)
  if (!exam || exam.teacher_id !== user.id) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }
  if (minutes !== null && exam.type === 'homework') {
    return NextResponse.json({ ...(await apiErr('homeworkEditFromLesson')) }, { status: 400 })
  }
  const updated = maybeOne<Row>(updatedRows)
  if (!updated) {
    console.error('[api/exams PATCH] no row updated', id)
    return NextResponse.json({ ...(await apiErr('examUpdateFailed')) }, { status: 500 })
  }
  return NextResponse.json(updated)
}

export async function DELETE(request: Request) {
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const user = { id: ctx.sub }

  let body: { id?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { id } = body
  if (!id) return NextResponse.json({ ...(await apiErr('missingId')) }, { status: 400 })
  if (!UUID.test(id)) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })

  if (!ctx.tenant_id) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  const profile = { tenant_id: ctx.tenant_id }

  const [rows] = await run({ as: 'service', tenantId: profile.tenant_id }, sql => [
    sql`select teacher_id from public.exams where id = ${id}`,
  ])
  if (maybeOne<{ teacher_id: string }>(rows)?.teacher_id !== user.id) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  // Archive by default; hard delete only when the owner enabled it.
  const { error, mode } = await deleteEntityAs(user.id, profile.tenant_id, 'exam', id)
  if (error) {
    console.error('[api/exams DELETE]', error instanceof Error ? error.message : error)
    return NextResponse.json({ ...(await apiErr('examDeleteFailed')) }, { status: 500 })
  }
  return NextResponse.json({ ok: true, mode })
}
