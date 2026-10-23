import { currentCtx } from '@/lib/auth/current'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne, type Row } from '@/lib/db/sql'

interface LessonInput {
  title: string
  order: number
}

interface UnitInput {
  name: string
  order: number
  lessons: LessonInput[]
}

interface CourseInput {
  title: string
  description: string
  language: string
  has_levels: boolean
  units: UnitInput[]
}

// POST /api/courses/create-full — create course + units + lessons in one shot.
//
// One unit, as app_service pinned to the caller's institution: the caller's
// live row decides (may create courses, active), and the course, every unit
// and every lesson are written together — each statement only while that
// row still allows it. The ids are chosen here so units and lessons can name
// their parents (a row inserted by an earlier statement of the unit is
// visible to the next one). Either all of it is created or none of it.
export async function POST(request: Request) {
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  if (!ctx.tenant_id) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  const tenantId = ctx.tenant_id
  const userId = ctx.sub

  const [me] = await run({ as: 'service', tenantId }, sql => [
    sql`select can_create_courses from public.users where id = ${userId} and tenant_id = ${tenantId} and is_active is not false`,
  ])
  if (maybeOne<{ can_create_courses: boolean | null }>(me)?.can_create_courses !== true) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  let body: { course?: CourseInput; source_text?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { course, source_text } = body
  if (!course?.title?.trim()) return NextResponse.json({ ...(await apiErr('courseTitleRequired')) }, { status: 400 })
  if (!Array.isArray(course.units) || course.units.length === 0) {
    return NextResponse.json({ ...(await apiErr('unitRequired')) }, { status: 400 })
  }

  const courseId = crypto.randomUUID()
  const units = course.units.map(u => ({ id: crypto.randomUUID(), title: String(u.name ?? ''), order_index: Number(u.order) || 0 }))
  // unit_items.type is constrained to ('grammar','idioms','rules','task','quiz','video','text').
  // A generated lesson is a markdown body, so it maps to 'text' (same as the manual
  // "Text / Explanation" item). Using 'lesson' here silently violated the CHECK
  // constraint, so no items were ever created — every unit showed "0 items".
  const items = course.units.flatMap((u, k) => (Array.isArray(u.lessons) ? u.lessons : []).map(l => ({
    unit_id: units[k].id, title: String(l.title ?? ''), order_index: Number(l.order) || 0,
  })))

  try {
    const rows = await run({ as: 'service', tenantId }, sql => [
      sql`insert into public.courses (id, title, description, language, has_levels, teacher_id, tenant_id, source_text)
          select ${courseId}, ${course.title.trim()}, ${course.description || null}, ${course.language || null},
                 ${course.has_levels ?? false}, ${userId}, ${tenantId}, ${source_text?.slice(0, 12000) || null}
           where exists (select 1 from public.users where id = ${userId} and tenant_id = ${tenantId}
                           and is_active is not false and can_create_courses)`,
      sql`insert into public.course_units (id, course_id, tenant_id, level_id, title, order_index)
          select u.id, c.id, c.tenant_id, null, u.title, u.order_index
            from jsonb_to_recordset(${sql.json(units)}) as u(id uuid, title text, order_index int)
            join public.courses c on c.id = ${courseId}`,
      ...(items.length ? [
        sql`insert into public.unit_items (unit_id, course_id, tenant_id, title, type, content, order_index)
            select i.unit_id, c.id, c.tenant_id, i.title, 'text', ${sql.json({ body: '' })}, i.order_index
              from jsonb_to_recordset(${sql.json(items)}) as i(unit_id uuid, title text, order_index int)
              join public.courses c on c.id = ${courseId}`,
      ] : []),
      sql`select c.*,
                 json_build_array(json_build_object('count', (select count(*) from public.course_levels l where l.course_id = c.id))) as course_levels,
                 json_build_array(json_build_object('count', (select count(*) from public.course_enrollments e where e.course_id = c.id))) as course_enrollments
            from public.courses c where c.id = ${courseId}`,
    ])
    const created = maybeOne<Row>(rows[rows.length - 1])
    if (!created) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
    return NextResponse.json(created, { status: 201 })
  } catch (e) {
    console.error('[create-full]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('courseCreateFailed')) }, { status: 500 })
  }
}
