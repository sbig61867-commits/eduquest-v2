import { currentCtx } from '@/lib/auth/current'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne, type Row } from '@/lib/db/sql'
import { deleteEntityAs } from '@/lib/delete-entity'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LIST_LIMIT = 200

// The institution scope comes from the session context; every write below
// still checks the caller against the LIVE row (role, institution, active)
// and ownership inside the same statement, as in /api/exams.

// GET /api/homework?lesson_id=xxx  — list homework for a lesson
export async function GET(request: Request) {
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const lessonId = searchParams.get('lesson_id')
  if (!lessonId) return NextResponse.json({ ...(await apiErr('lessonIdRequired')) }, { status: 400 })
  if (!ctx.tenant_id) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  if (!UUID.test(lessonId)) return NextResponse.json([])

  // Read as the teacher: RLS scopes exams and submissions to their own.
  try {
    const [rows] = await run({ as: 'user', userId: ctx.sub }, sql => [
      sql`select e.id, e.type, e.title, e.lesson_id, e.group_id, e.teacher_id, e.tenant_id, e.questions,
                 e.duration_minutes, e.ends_at, e.is_published, e.auto_publish, e.created_at,
                 json_build_array(json_build_object('count',
                   (select count(*) from public.exam_submissions s where s.exam_id = e.id))) as exam_submissions
            from public.exams e
           where e.lesson_id = ${lessonId} and e.type = 'homework' and e.teacher_id = ${ctx.sub} and e.deleted_at is null
           order by e.created_at
           limit ${LIST_LIMIT}`,
    ])
    return NextResponse.json(rows)
  } catch (e) {
    console.error('[api/homework GET]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('homeworkLoadFailed')) }, { status: 500 })
  }
}

// POST /api/homework — create homework for a lesson
export async function POST(request: Request) {
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const user = { id: ctx.sub }
  if (!ctx.tenant_id || !['teacher', 'university_admin', 'super_admin'].includes(ctx.role ?? '')) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }
  const tenantId = ctx.tenant_id

  let body: { lesson_id?: string; group_id?: string; title?: string; questions?: unknown[]; due_date?: string; auto_publish?: boolean }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { lesson_id, group_id, title, questions, due_date, auto_publish } = body

  if (!lesson_id || !group_id || !title?.trim()) {
    return NextResponse.json({ ...(await apiErr('lessonGroupTitleRequired')) }, { status: 400 })
  }
  if (!Array.isArray(questions) || questions.length === 0) {
    return NextResponse.json({ ...(await apiErr('questionRequired')) }, { status: 400 })
  }
  // Expect an ISO instant from the client (it converts the local datetime);
  // reject anything unparseable instead of letting the insert 500.
  if (due_date != null && isNaN(new Date(due_date).getTime())) {
    return NextResponse.json({ ...(await apiErr('invalidDate')) }, { status: 400 })
  }
  if (!UUID.test(lesson_id)) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  if (!UUID.test(group_id)) return NextResponse.json({ ...(await apiErr('groupNotFound')) }, { status: 404 })

  // One unit, as app_service pinned to the caller's institution:
  //  1. the lesson and the group as they stand (for a precise refusal)
  //  2. the insert, which happens ONLY when the lesson is the caller's own in
  //     this institution, and the target group — client-supplied, it decides
  //     who the homework is served to — is in this institution and, for a
  //     teacher, their own (else homework could land in a colleague's group,
  //     or another tenant's: the tenant column alone never catches that).
  // Students see homework detached from the lesson (exams page, grades), so
  // the lesson name is baked into the title — joined with a neutral dash, as
  // the title is stored once and read in both languages.
  // Homework is untimed for the student; the large duration only satisfies
  // the finalize RPC's deadline check — the real cutoff is ends_at.
  const cleanTitle = title.trim()
  const [lessonRows, groupRows, createdRows] = await run({ as: 'service', tenantId }, sql => [
    sql`select teacher_id, tenant_id from public.lessons where id = ${lesson_id}`,
    sql`select teacher_id, tenant_id from public.groups where id = ${group_id}`,
    sql`
      with me as (
        select role, tenant_id from public.users where id = ${user.id} and is_active is not false
      ), l as (
        select title from public.lessons, me
         where id = ${lesson_id} and teacher_id = ${user.id} and lessons.tenant_id = me.tenant_id
      ), g as (
        select 1 from public.groups, me
         where id = ${group_id} and groups.tenant_id = me.tenant_id
           and (me.role <> 'teacher' or groups.teacher_id = ${user.id})
      )
      insert into public.exams (type, lesson_id, group_id, teacher_id, tenant_id, title, questions,
                                duration_minutes, ends_at, is_published, auto_publish)
      select 'homework', ${lesson_id}, ${group_id}, ${user.id}, me.tenant_id,
             case when l.title is not null and l.title <> '' and strpos(${cleanTitle}, l.title) = 0
                  then ${cleanTitle} || ' — ' || l.title else ${cleanTitle} end,
             ${sql.json(questions as Parameters<typeof sql.json>[0])}, 43200,
             ${due_date ? new Date(due_date).toISOString() : null}, true, ${auto_publish !== false}
        from me, l, g
       where me.role in ('teacher', 'university_admin', 'super_admin')
      returning *`,
  ])

  const created = maybeOne<Row>(createdRows)
  if (created) return NextResponse.json(created, { status: 201 })

  // Nothing was written: say why.
  const lesson = maybeOne<{ teacher_id: string; tenant_id: string }>(lessonRows)
  if (!lesson || lesson.teacher_id !== user.id || lesson.tenant_id !== tenantId) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }
  const group = maybeOne<{ teacher_id: string; tenant_id: string }>(groupRows)
  if (!group || group.tenant_id !== tenantId) {
    return NextResponse.json({ ...(await apiErr('groupNotFound')) }, { status: 404 })
  }
  return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
}

// PATCH /api/homework — update (publish toggle or questions)
export async function PATCH(request: Request) {
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const user = { id: ctx.sub }
  if (!ctx.tenant_id) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })

  let body: { id?: string; is_published?: boolean; title?: string; questions?: unknown[] }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { id, ...rest } = body
  if (!id) return NextResponse.json({ ...(await apiErr('missingId')) }, { status: 400 })
  if (!UUID.test(id)) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })

  // One unit: the update touches the row only when it is this teacher's, in
  // this institution; nothing updated means it is not theirs.
  const [rows] = await run({ as: 'service', tenantId: ctx.tenant_id }, sql => [
    sql`
      update public.exams set
        is_published = coalesce(${rest.is_published ?? null}::boolean, is_published),
        title = coalesce(${rest.title ?? null}::text, title),
        questions = coalesce(${rest.questions === undefined ? null : sql.json(rest.questions as Parameters<typeof sql.json>[0])}::jsonb, questions)
       where id = ${id} and teacher_id = ${user.id} and tenant_id = ${ctx.tenant_id}
      returning *`,
  ])
  const updated = maybeOne<Row>(rows)
  if (!updated) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  return NextResponse.json(updated)
}

// DELETE /api/homework
export async function DELETE(request: Request) {
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const user = { id: ctx.sub }
  if (!ctx.tenant_id) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })

  let body: { id?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const id = body.id
  if (!id) return NextResponse.json({ ...(await apiErr('missingId')) }, { status: 400 })
  if (!UUID.test(id)) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })

  const [rows] = await run({ as: 'service', tenantId: ctx.tenant_id }, sql => [
    sql`select teacher_id from public.exams where id = ${id} and tenant_id = ${ctx.tenant_id}`,
  ])
  if (maybeOne<{ teacher_id: string }>(rows)?.teacher_id !== user.id) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  // Archive by default; hard delete only when the owner enabled it.
  const { error, mode } = await deleteEntityAs(user.id, ctx.tenant_id, 'exam', id)
  if (error) {
    console.error('[api/homework DELETE]', error instanceof Error ? error.message : error)
    return NextResponse.json({ ...(await apiErr('homeworkDeleteFailed')) }, { status: 500 })
  }
  return NextResponse.json({ ok: true, mode })
}
