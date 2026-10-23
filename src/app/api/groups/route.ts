import { currentCtx } from '@/lib/auth/current'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne, type Row, type Sql } from '@/lib/db/sql'
import { deleteEntityAs } from '@/lib/delete-entity'
import { staffCan } from '@/lib/staff-auth'
import { parseGroupFields } from '@/lib/group-fields'

// What a group write needs to decide is read in ONE unit, as app_service
// pinned to the session's institution: the caller's LIVE row, and on request
// the group, a would-be teacher, a linked course and an academic unit / term
// — each only if it is in this institution. The write that follows runs in
// the same scope and repeats the live check (and, for a teacher, ownership).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Profile = { role: string; tenant_id: string; permissions: Record<string, unknown> | null; structure_mode: string | null }

/** teacher (own groups) · staff (admin, centre manager) holding manage_groups · super_admin */
function mayManageGroups(profile: Profile | null): profile is Profile {
  if (!profile) return false
  if (profile.role === 'teacher') return true
  // staffCan: super_admin always; university_admin default ON (owner may
  // switch it off); center_manager default OFF.
  return staffCan(profile, 'manage_groups')
}

const uuidOrNull = (v: unknown) => (typeof v === 'string' && UUID.test(v) ? v : null)

async function loadGroupCaller(opts: { groupId?: string; teacherId?: unknown; courseId?: unknown; unitId?: unknown; termId?: unknown } = {}) {
  const ctx = await currentCtx()
  if (!ctx) return { error: NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 }) }
  if (!ctx.tenant_id) return { error: NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 }) }
  const tenantId = ctx.tenant_id
  const teacherId = uuidOrNull(opts.teacherId)
  const courseId = uuidOrNull(opts.courseId)
  const unitId = uuidOrNull(opts.unitId)
  const termId = uuidOrNull(opts.termId)
  const [me, group, teacher, course, unit, term] = await run({ as: 'service', tenantId }, sql => [
    sql`select u.role, u.tenant_id, u.permissions, t.structure_mode
          from public.users u join public.tenants t on t.id = u.tenant_id
         where u.id = ${ctx.sub} and u.tenant_id = ${tenantId} and u.is_active is not false`,
    sql`select id, teacher_id from public.groups where id = ${opts.groupId ?? null}::uuid and tenant_id = ${tenantId}`,
    sql`select id from public.users where id = ${teacherId}::uuid and tenant_id = ${tenantId} and role = 'teacher'`,
    sql`select id from public.courses where id = ${courseId}::uuid and tenant_id = ${tenantId}`,
    sql`select id from public.academic_units where id = ${unitId}::uuid and tenant_id = ${tenantId} and deleted_at is null`,
    sql`select id from public.academic_terms where id = ${termId}::uuid and tenant_id = ${tenantId} and deleted_at is null`,
  ])
  const profile = maybeOne<Profile>(me)
  if (!mayManageGroups(profile)) return { error: NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 }) }
  return {
    userId: ctx.sub, tenantId, profile,
    group: maybeOne<{ id: string; teacher_id: string }>(group),
    teacherOk: !!maybeOne(teacher), courseOk: !!maybeOne(course), unitOk: !!maybeOne(unit), termOk: !!maybeOne(term),
  }
}

/** The caller is still live in this institution with the role the rules were applied to. */
const liveCaller = (sql: Sql, userId: string, tenantId: string, role: string) =>
  sql`exists (select 1 from public.users where id = ${userId} and tenant_id = ${tenantId} and is_active is not false and role = ${role})`

export async function POST(request: Request) {
  let body: { name?: string; description?: string; teacher_id?: string } & Record<string, unknown>
  try { body = await request.json() }
  catch { body = {} }

  const auth = await loadGroupCaller({ teacherId: body.teacher_id, courseId: body.course_id })
  if ('error' in auth) return auth.error
  const { userId, tenantId, profile } = auth
  if (!Object.keys(body).length) return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })

  const { name, description } = body
  if (!name?.trim()) return NextResponse.json({ ...(await apiErr('groupNameRequired')) }, { status: 400 })

  // Optional: course link, image, seat cap, instructions.
  const parsed = parseGroupFields(body)
  if ('error' in parsed) return NextResponse.json({ ...(await apiErr(parsed.error)) }, { status: 400 })
  if (parsed.update.course_id && !auth.courseOk) {
    return NextResponse.json({ ...(await apiErr('courseNotInTenant')) }, { status: 400 })
  }

  // Teachers always own the groups they create. Staff assign a real teacher;
  // a centre manager is not a teacher, so for them the assignment is required.
  let teacherId = userId
  if (profile.role !== 'teacher') {
    if (body.teacher_id) {
      if (!auth.teacherOk) return NextResponse.json({ ...(await apiErr('teacherNotInTenant')) }, { status: 400 })
      teacherId = body.teacher_id
    } else if (profile.role === 'center_manager') {
      return NextResponse.json({ ...(await apiErr('chooseGroupTeacher')) }, { status: 400 })
    }
  }

  const f = parsed.update
  try {
    const [rows] = await run({ as: 'service', tenantId }, sql => [
      sql`with ins as (
            insert into public.groups (name, description, teacher_id, tenant_id, course_id, image_url, max_students, instructions)
            select ${name.trim()}, ${description?.trim() || null}, ${teacherId}, ${tenantId},
                   ${f.course_id ?? null}, ${f.image_url ?? null}, ${f.max_students ?? null}, ${f.instructions ?? null}
             where ${liveCaller(sql, userId, tenantId, profile.role)}
            returning *
          )
          select ins.*, json_build_array(json_build_object('count', 0)) as group_students from ins`,
    ])
    const created = maybeOne<Row>(rows)
    if (!created) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
    return NextResponse.json(created, { status: 201 })
  } catch (e) {
    console.error('[api/groups POST]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('groupCreateFailed')) }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  let body: {
    id?: string; name?: string; description?: string; is_active?: boolean; teacher_id?: string
    academic_unit_id?: string | null; term_id?: string | null
  } & Record<string, unknown>
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { id, name, description, is_active, teacher_id, academic_unit_id, term_id } = body
  if (!id) return NextResponse.json({ ...(await apiErr('missingId')) }, { status: 400 })
  if (name !== undefined && !name.trim()) return NextResponse.json({ ...(await apiErr('nameEmpty')) }, { status: 400 })
  const classifying = academic_unit_id !== undefined || term_id !== undefined
  const parsed = parseGroupFields(body)
  if ('error' in parsed) return NextResponse.json({ ...(await apiErr(parsed.error)) }, { status: 400 })
  const hasGroupFields = Object.keys(parsed.update).length > 0
  if (name === undefined && is_active === undefined && teacher_id === undefined && !classifying && !hasGroupFields) {
    return NextResponse.json({ ...(await apiErr('nothingToUpdate')) }, { status: 400 })
  }

  const auth = await loadGroupCaller({
    groupId: UUID.test(id) ? id : undefined, teacherId: teacher_id, courseId: parsed.update.course_id,
    unitId: academic_unit_id, termId: term_id,
  })
  if ('error' in auth) return auth.error
  const { userId, tenantId, profile, group } = auth

  if (!group) return NextResponse.json({ ...(await apiErr('groupNotFound')) }, { status: 404 })
  if (profile.role === 'teacher' && group.teacher_id !== userId) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  if (teacher_id !== undefined) {
    // Reassigning the teacher is a staff action, never a teacher's.
    if (profile.role === 'teacher') return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
    if (!auth.teacherOk) return NextResponse.json({ ...(await apiErr('teacherNotInTenant')) }, { status: 400 })
  }
  if (hasGroupFields) {
    // Course link / image / cap / instructions are staff settings, not a teacher's.
    if (profile.role === 'teacher') return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
    if (parsed.update.course_id && !auth.courseOk) {
      return NextResponse.json({ ...(await apiErr('courseNotInTenant')) }, { status: 400 })
    }
  }
  if (classifying) {
    // Placing a group in the academic structure is a staff action.
    if (!staffCan(profile, 'manage_academic_structure')) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
    if (profile.structure_mode !== 'academic') return NextResponse.json({ ...(await apiErr('academicDisabled')) }, { status: 409 })
    // The DB trigger rejects a foreign-tenant link too; this gives a clean 400.
    if ((academic_unit_id && !auth.unitOk) || (term_id && !auth.termOk)) {
      return NextResponse.json({ ...(await apiErr('notInTenant')) }, { status: 400 })
    }
  }

  // Each column changes only when it was sent; `set(k)` marks the ones that were.
  const f = parsed.update
  const set = (k: string) => k in body
  const ownerOnly = profile.role === 'teacher'
  try {
    const [rows] = await run({ as: 'service', tenantId }, sql => [
      sql`update public.groups g set
            name = case when ${name !== undefined} then ${name?.trim() ?? null}::text else g.name end,
            description = case when ${name !== undefined} then ${description?.trim() || null}::text else g.description end,
            is_active = coalesce(${is_active ?? null}::boolean, g.is_active),
            teacher_id = coalesce(${teacher_id ?? null}::uuid, g.teacher_id),
            course_id = case when ${set('course_id')} then ${f.course_id ?? null}::uuid else g.course_id end,
            image_url = case when ${set('image_url')} then ${f.image_url ?? null}::text else g.image_url end,
            max_students = case when ${set('max_students')} then ${f.max_students ?? null}::int else g.max_students end,
            instructions = case when ${set('instructions')} then ${f.instructions ?? null}::text else g.instructions end,
            academic_unit_id = case when ${academic_unit_id !== undefined} then ${academic_unit_id ?? null}::uuid else g.academic_unit_id end,
            term_id = case when ${term_id !== undefined} then ${term_id ?? null}::uuid else g.term_id end
          where g.id = ${id} and g.tenant_id = ${tenantId}
            and ${liveCaller(sql, userId, tenantId, profile.role)}
            and (not ${ownerOnly} or g.teacher_id = ${userId})
          returning g.*`,
    ])
    const updated = maybeOne<Row>(rows)
    if (!updated) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
    return NextResponse.json(updated)
  } catch (e) {
    console.error('[api/groups PATCH]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('groupUpdateFailed')) }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  let body: { id?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { id } = body
  if (!id) return NextResponse.json({ ...(await apiErr('missingId')) }, { status: 400 })

  const auth = await loadGroupCaller({ groupId: UUID.test(id) ? id : undefined })
  if ('error' in auth) return auth.error
  const { userId, tenantId, profile, group } = auth
  if (!group) return NextResponse.json({ ...(await apiErr('groupNotFound')) }, { status: 404 })
  if (profile.role === 'teacher' && group.teacher_id !== userId) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  // Archive by default; permanently delete only if the owner enabled hard
  // deletion in platform settings.
  const { error, mode } = await deleteEntityAs(userId, tenantId, 'group', id)
  if (error) {
    console.error('[api/groups DELETE]', error instanceof Error ? error.message : error)
    return NextResponse.json({ ...(await apiErr('groupDeleteFailed')) }, { status: 500 })
  }
  return NextResponse.json({ success: true, mode })
}
