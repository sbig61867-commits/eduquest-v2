import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { deleteEntity } from '@/lib/delete-entity'
import { serviceClient, staffCan, isTenantTeacher } from '@/lib/staff-auth'

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
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!mayManageGroups(profile)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { name?: string; description?: string; teacher_id?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { name, description } = body
  if (!name?.trim()) return NextResponse.json({ error: 'Group name is required' }, { status: 400 })

  const admin = serviceClient()

  // Teachers always own the groups they create. Staff assign a real teacher;
  // a centre manager is not a teacher, so for them the assignment is required.
  let teacherId = user.id
  if (profile.role !== 'teacher') {
    if (body.teacher_id) {
      if (!(await isTenantTeacher(admin, profile.tenant_id, body.teacher_id))) {
        return NextResponse.json({ error: 'المدرب المحدد غير موجود في مؤسستك' }, { status: 400 })
      }
      teacherId = body.teacher_id
    } else if (profile.role === 'center_manager') {
      return NextResponse.json({ error: 'اختر مدرب المجموعة' }, { status: 400 })
    }
  }

  const { data, error } = await admin
    .from('groups')
    .insert({
      name: name.trim(),
      description: description?.trim() || null,
      teacher_id: teacherId,
      tenant_id: profile.tenant_id,
    })
    .select('*, group_students(count)')
    .single()

  if (error) {
    console.error('[api/groups POST]', error)
    return NextResponse.json({ error: 'Failed to create group' }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}

export async function PATCH(request: Request) {
  const { user, profile } = await loadCaller()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!mayManageGroups(profile)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { id?: string; name?: string; description?: string; is_active?: boolean; teacher_id?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { id, name, description, is_active, teacher_id } = body
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  if (name !== undefined && !name.trim()) return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 })
  if (name === undefined && is_active === undefined && teacher_id === undefined) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const admin = serviceClient()
  const { data: group } = await admin
    .from('groups').select('id, teacher_id, tenant_id').eq('id', id).single()

  if (!group || group.tenant_id !== profile.tenant_id) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 })
  }
  if (profile.role === 'teacher' && group.teacher_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const update: Record<string, unknown> = {}
  if (name !== undefined) { update.name = name.trim(); update.description = description?.trim() || null }
  // Archive/restore: archived groups keep every record but disappear from
  // the students' lessons/exams views.
  if (is_active !== undefined) update.is_active = is_active
  if (teacher_id !== undefined) {
    // Reassigning the teacher is a staff action, never a teacher's.
    if (profile.role === 'teacher') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!(await isTenantTeacher(admin, profile.tenant_id, teacher_id))) {
      return NextResponse.json({ error: 'المدرب المحدد غير موجود في مؤسستك' }, { status: 400 })
    }
    update.teacher_id = teacher_id
  }

  const { data, error } = await admin
    .from('groups').update(update).eq('id', id).select().single()

  if (error) {
    console.error('[api/groups PATCH]', error)
    return NextResponse.json({ error: 'Failed to update group' }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function DELETE(request: Request) {
  const { supabase, user, profile } = await loadCaller()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!mayManageGroups(profile)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { id?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { id } = body
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const admin = serviceClient()
  const { data: group } = await admin
    .from('groups').select('id, teacher_id, tenant_id').eq('id', id).single()

  if (!group || group.tenant_id !== profile.tenant_id) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 })
  }
  if (profile.role === 'teacher' && group.teacher_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Archive by default; permanently delete only if the owner enabled hard
  // deletion in platform settings.
  const { error, mode } = await deleteEntity(admin, supabase, 'group', id, user.id, profile.tenant_id)
  if (error) {
    console.error('[api/groups DELETE]', error)
    return NextResponse.json({ error: 'Failed to delete group' }, { status: 500 })
  }
  return NextResponse.json({ success: true, mode })
}
