import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { deleteEntity } from '@/lib/delete-entity'
import { serviceClient, staffCan, isTenantTeacher } from '@/lib/staff-auth'
import { getTenantStructureMode } from '@/lib/structure-mode'
import { parseGroupFields, courseInTenant } from '@/lib/group-fields'

// Auth/authz uses the user session (RLS-scoped).
// Writes use the service-role client to bypass RLS — safe because authorization
// is fully enforced in application code above before any write happens.

type Profile = { role: string; tenant_id: string | null; permissions: Record<string, unknown> | null }

async function loadCaller() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { supabase, user: null, profile: null }
  const { data: profile } = await supabase
    .from('users').select('role, tenant_id, permissions').eq('id', user.id).single()
  return { supabase, user, profile: profile as Profile | null }
}

/** teacher (own groups) · university_admin / super_admin · center_manager with manage_groups */
function mayManageGroups(profile: Profile | null): profile is Profile & { tenant_id: string } {
  if (!profile?.tenant_id) return false
  if (['teacher', 'university_admin', 'super_admin'].includes(profile.role)) return true
  return profile.role === 'center_manager' && staffCan(profile, 'manage_groups')
}

export async function POST(request: Request) {
  const { user, profile } = await loadCaller()
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  if (!mayManageGroups(profile)) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })

  let body: { name?: string; description?: string; teacher_id?: string } & Record<string, unknown>
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { name, description } = body
  if (!name?.trim()) return NextResponse.json({ ...(await apiErr('groupNameRequired')) }, { status: 400 })

  const admin = serviceClient()

  // Optional: course link, image, seat cap, instructions.
  const parsed = parseGroupFields(body)
  if ('error' in parsed) return NextResponse.json({ ...(await apiErr(parsed.error)) }, { status: 400 })
  if (!(await courseInTenant(admin, profile.tenant_id, parsed.update.course_id))) {
    return NextResponse.json({ ...(await apiErr('courseNotInTenant')) }, { status: 400 })
  }

  // Teachers always own the groups they create. Staff assign a real teacher;
  // a centre manager is not a teacher, so for them the assignment is required.
  let teacherId = user.id
  if (profile.role !== 'teacher') {
    if (body.teacher_id) {
      if (!(await isTenantTeacher(admin, profile.tenant_id, body.teacher_id))) {
        return NextResponse.json({ ...(await apiErr('teacherNotInTenant')) }, { status: 400 })
      }
      teacherId = body.teacher_id
    } else if (profile.role === 'center_manager') {
      return NextResponse.json({ ...(await apiErr('chooseGroupTeacher')) }, { status: 400 })
    }
  }

  const { data, error } = await admin
    .from('groups')
    .insert({
      name: name.trim(),
      description: description?.trim() || null,
      teacher_id: teacherId,
      tenant_id: profile.tenant_id,
      // Only sent when set, so creating a plain group keeps working pre-migration.
      ...Object.fromEntries(Object.entries(parsed.update).filter(([, v]) => v !== null && v !== undefined)),
    })
    .select('*, group_students(count)')
    .single()

  if (error) {
    console.error('[api/groups POST]', error)
    return NextResponse.json({ ...(await apiErr('groupCreateFailed')) }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}

export async function PATCH(request: Request) {
  const { user, profile } = await loadCaller()
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  if (!mayManageGroups(profile)) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })

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

  const admin = serviceClient()
  const { data: group } = await admin
    .from('groups').select('id, teacher_id, tenant_id').eq('id', id).single()

  if (!group || group.tenant_id !== profile.tenant_id) {
    return NextResponse.json({ ...(await apiErr('groupNotFound')) }, { status: 404 })
  }
  if (profile.role === 'teacher' && group.teacher_id !== user.id) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  const update: Record<string, unknown> = {}
  if (name !== undefined) { update.name = name.trim(); update.description = description?.trim() || null }
  // Archive/restore: archived groups keep every record but disappear from
  // the students' lessons/exams views.
  if (is_active !== undefined) update.is_active = is_active
  if (teacher_id !== undefined) {
    // Reassigning the teacher is a staff action, never a teacher's.
    if (profile.role === 'teacher') return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
    if (!(await isTenantTeacher(admin, profile.tenant_id, teacher_id))) {
      return NextResponse.json({ ...(await apiErr('teacherNotInTenant')) }, { status: 400 })
    }
    update.teacher_id = teacher_id
  }
  if (hasGroupFields) {
    // Course link / image / cap / instructions are staff settings, not a teacher's.
    if (profile.role === 'teacher') return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
    if (!(await courseInTenant(admin, profile.tenant_id, parsed.update.course_id))) {
      return NextResponse.json({ ...(await apiErr('courseNotInTenant')) }, { status: 400 })
    }
    Object.assign(update, parsed.update)
  }
  if (classifying) {
    // Placing a group in the academic structure is a staff action.
    if (!staffCan(profile, 'manage_academic_structure')) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
    if ((await getTenantStructureMode(admin, profile.tenant_id)) !== 'academic') {
      return NextResponse.json({ ...(await apiErr('academicDisabled')) }, { status: 409 })
    }
    for (const [column, table, value] of [
      ['academic_unit_id', 'academic_units', academic_unit_id],
      ['term_id', 'academic_terms', term_id],
    ] as const) {
      if (value === undefined) continue
      if (value !== null) {
        // The DB trigger rejects a foreign-tenant link too; this gives a clean 400.
        const { data: target } = await admin
          .from(table).select('id').eq('id', value).eq('tenant_id', profile.tenant_id).is('deleted_at', null).maybeSingle()
        if (!target) return NextResponse.json({ ...(await apiErr('notInTenant')) }, { status: 400 })
      }
      update[column] = value
    }
  }

  const { data, error } = await admin
    .from('groups').update(update).eq('id', id).select().single()

  if (error) {
    console.error('[api/groups PATCH]', error)
    return NextResponse.json({ ...(await apiErr('groupUpdateFailed')) }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function DELETE(request: Request) {
  const { supabase, user, profile } = await loadCaller()
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  if (!mayManageGroups(profile)) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })

  let body: { id?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { id } = body
  if (!id) return NextResponse.json({ ...(await apiErr('missingId')) }, { status: 400 })

  const admin = serviceClient()
  const { data: group } = await admin
    .from('groups').select('id, teacher_id, tenant_id').eq('id', id).single()

  if (!group || group.tenant_id !== profile.tenant_id) {
    return NextResponse.json({ ...(await apiErr('groupNotFound')) }, { status: 404 })
  }
  if (profile.role === 'teacher' && group.teacher_id !== user.id) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  // Archive by default; permanently delete only if the owner enabled hard
  // deletion in platform settings.
  const { error, mode } = await deleteEntity(admin, supabase, 'group', id, user.id, profile.tenant_id)
  if (error) {
    console.error('[api/groups DELETE]', error)
    return NextResponse.json({ ...(await apiErr('groupDeleteFailed')) }, { status: 500 })
  }
  return NextResponse.json({ success: true, mode })
}
