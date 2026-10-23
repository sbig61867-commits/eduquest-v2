import { currentCtx } from '@/lib/auth/current'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne, type Row } from '@/lib/db/sql'
import { deleteEntityAs } from '@/lib/delete-entity'
import { isLessonDocText, sanitizeLessonDoc, serializeLessonDoc } from '@/lib/lesson-doc'
import { isOwnLessonImage } from '@/lib/exam-files'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Block lessons (src/lib/lesson-doc.ts) are re-validated here: the JSON is
 * rebuilt from known fields only, and an image block may only point at the
 * author's own uploads. Returns null for a malformed document. Markdown passes through.
 */
function cleanContent(content: string, tenantId: string, teacherId: string): string | null {
  if (!isLessonDocText(content)) return content
  let doc
  try { doc = sanitizeLessonDoc(JSON.parse(content)) } catch { return null }
  if (!doc) return null
  for (const s of doc.sections) {
    for (const b of s.blocks) if (b.type === 'image' && !isOwnLessonImage(b.path, tenantId, teacherId)) b.path = ''
  }
  return serializeLessonDoc(doc)
}

// The institution scope comes from the session context; every write still
// checks the caller against the LIVE row (role, institution, active) and the
// ownership inside the same statement, as in /api/exams.

// POST /api/lessons — create lesson
export async function POST(request: Request) {
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const user = { id: ctx.sub }
  if (!ctx.tenant_id || !['teacher', 'university_admin', 'super_admin'].includes(ctx.role ?? '')) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }
  const tenantId = ctx.tenant_id

  let body: { title?: string; content?: string; group_id?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { title, group_id } = body
  const content = cleanContent(body.content ?? '', tenantId, user.id)
  if (content === null) return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
  if (!title?.trim() || !group_id) {
    return NextResponse.json({ ...(await apiErr('titleAndGroupRequired')) }, { status: 400 })
  }
  if (!UUID.test(group_id)) return NextResponse.json({ ...(await apiErr('groupNotFound')) }, { status: 404 })

  // One unit: the group as it stands (for a precise refusal), then the insert,
  // which happens ONLY when the group is in the caller's live institution and
  // — for a teacher — their own.
  const [groupRows, createdRows] = await run({ as: 'service', tenantId }, sql => [
    sql`select teacher_id, tenant_id from public.groups where id = ${group_id}`,
    sql`with me as (
          select role, tenant_id from public.users where id = ${user.id} and is_active is not false
        ), ins as (
          insert into public.lessons (title, content, group_id, teacher_id, tenant_id)
          select ${title.trim()}, ${content}, g.id, ${user.id}, me.tenant_id
            from me, public.groups g
           where g.id = ${group_id} and g.tenant_id = me.tenant_id
             and me.role in ('teacher', 'university_admin', 'super_admin')
             and (me.role <> 'teacher' or g.teacher_id = ${user.id})
          returning *
        )
        select ins.*, json_build_object('name', g.name) as groups
          from ins join public.groups g on g.id = ins.group_id`,
  ])

  const created = maybeOne<Row>(createdRows)
  if (created) return NextResponse.json(created, { status: 201 })

  const group = maybeOne<{ teacher_id: string; tenant_id: string }>(groupRows)
  if (!group || group.tenant_id !== tenantId) {
    return NextResponse.json({ ...(await apiErr('groupNotFound')) }, { status: 404 })
  }
  return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
}

// PATCH /api/lessons — update lesson
export async function PATCH(request: Request) {
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const user = { id: ctx.sub }
  if (!ctx.tenant_id) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  const tenantId = ctx.tenant_id

  let body: { id?: string; title?: string; content?: string; is_published?: boolean }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { id, title, content, is_published } = body
  if (!id) return NextResponse.json({ ...(await apiErr('missingId')) }, { status: 400 })
  if (!UUID.test(id)) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })

  let clean: string | null = null
  if (content !== undefined) {
    clean = cleanContent(content, tenantId, user.id)
    if (clean === null) return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
  }

  // One statement: the update touches the lesson only when it is this
  // teacher's, in this institution, and the caller is still active; nothing
  // updated means it is not theirs.
  const [rows] = await run({ as: 'service', tenantId }, sql => [
    sql`with upd as (
          update public.lessons l set
            title = coalesce(${title === undefined ? null : title.trim()}::text, l.title),
            content = case when ${content !== undefined} then ${clean}::text else l.content end,
            is_published = coalesce(${is_published ?? null}::boolean, l.is_published)
           where l.id = ${id} and l.teacher_id = ${user.id} and l.tenant_id = ${tenantId}
             and exists (select 1 from public.users where id = ${user.id} and tenant_id = ${tenantId} and is_active is not false)
          returning l.*
        )
        select upd.*, case when g.id is null then null else json_build_object('name', g.name) end as groups
          from upd left join public.groups g on g.id = upd.group_id`,
  ])
  const updated = maybeOne<Row>(rows)
  if (!updated) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  return NextResponse.json(updated)
}

// DELETE /api/lessons — delete lesson
export async function DELETE(request: Request) {
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const user = { id: ctx.sub }
  if (!ctx.tenant_id) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  const tenantId = ctx.tenant_id

  let body: { id?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { id } = body
  if (!id) return NextResponse.json({ ...(await apiErr('missingId')) }, { status: 400 })
  if (!UUID.test(id)) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })

  const [rows] = await run({ as: 'service', tenantId }, sql => [
    sql`select teacher_id from public.lessons where id = ${id} and tenant_id = ${tenantId}`,
  ])
  if (maybeOne<{ teacher_id: string }>(rows)?.teacher_id !== user.id) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  // Archive by default; hard delete only when the owner enabled it.
  const { error, mode } = await deleteEntityAs(user.id, tenantId, 'lesson', id)
  if (error) {
    console.error('[api/lessons DELETE]', error instanceof Error ? error.message : error)
    return NextResponse.json({ ...(await apiErr('lessonDeleteFailed')) }, { status: 500 })
  }
  return NextResponse.json({ ok: true, mode })
}
