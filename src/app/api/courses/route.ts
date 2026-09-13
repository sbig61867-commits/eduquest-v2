import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient, staffCan, isTenantTeacher } from '@/lib/staff-auth'

type Profile = {
  role: string
  tenant_id: string | null
  can_create_courses: boolean | null
  permissions: Record<string, unknown> | null
}

async function loadCaller() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { user: null, profile: null }
  const { data } = await supabase
    .from('users').select('role, tenant_id, can_create_courses, permissions').eq('id', user.id).single()
  return { user, profile: data as Profile | null }
}

/** Staff (admin / centre manager with manage_courses) manage every course in their tenant. */
function isCourseStaff(profile: Profile) {
  return profile.role !== 'teacher' && staffCan(profile, 'manage_courses')
}

// POST /api/courses — create course
export async function POST(request: Request) {
  const { user, profile } = await loadCaller()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!profile?.tenant_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const staff = isCourseStaff(profile)
  const teacherSelf = profile.role === 'teacher' && profile.can_create_courses === true
  if (!staff && !teacherSelf) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { title?: string; description?: string; language?: string; has_levels?: boolean; teacher_id?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { title, description, language, has_levels } = body
  if (!title?.trim()) return NextResponse.json({ error: 'Title is required' }, { status: 400 })

  const admin = serviceClient()

  // A teacher owns what they create; staff must hand the course to a real
  // teacher in the tenant, who then builds its levels/units/content.
  let teacherId = user.id
  if (staff) {
    if (!(await isTenantTeacher(admin, profile.tenant_id, body.teacher_id))) {
      return NextResponse.json({ error: 'اختر مدرباً من مؤسستك لإسناد الكورس إليه' }, { status: 400 })
    }
    teacherId = body.teacher_id!
  }

  const { data, error } = await admin
    .from('courses')
    .insert({
      title: title.trim(),
      description: description || null,
      language: language || null,
      has_levels: has_levels ?? true,
      teacher_id: teacherId,
      tenant_id: profile.tenant_id,
    })
    .select('*, course_levels(count), course_enrollments(count)')
    .single()

  if (error) {
    console.error('[api/courses POST]', error)
    return NextResponse.json({ error: 'Failed to create course' }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}

/** Owner teacher, or course staff in the same tenant. */
async function authorizeCourse(courseId: string) {
  const { user, profile } = await loadCaller()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!profile?.tenant_id) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  const admin = serviceClient()
  const { data: course } = await admin
    .from('courses').select('teacher_id, tenant_id').eq('id', courseId).single()
  const allowed = !!course && course.tenant_id === profile.tenant_id &&
    (course.teacher_id === user.id || isCourseStaff(profile))
  if (!allowed) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { admin, profile: profile as Profile & { tenant_id: string } }
}

// PATCH /api/courses — update course (publish toggle, rename, reassign teacher)
export async function PATCH(request: Request) {
  let body: { id?: string; is_published?: boolean; title?: string; teacher_id?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { id, ...rest } = body
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const auth = await authorizeCourse(id)
  if ('error' in auth) return auth.error
  const { admin, profile } = auth

  const update: Record<string, unknown> = {}
  if (rest.is_published !== undefined) update.is_published = rest.is_published === true
  if (rest.title !== undefined) {
    if (!String(rest.title).trim()) return NextResponse.json({ error: 'Title is required' }, { status: 400 })
    update.title = String(rest.title).trim()
  }
  if (rest.teacher_id !== undefined) {
    if (!isCourseStaff(profile)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!(await isTenantTeacher(admin, profile.tenant_id, rest.teacher_id))) {
      return NextResponse.json({ error: 'المدرب المحدد غير موجود في مؤسستك' }, { status: 400 })
    }
    update.teacher_id = rest.teacher_id
  }
  if (Object.keys(update).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const { data, error } = await admin
    .from('courses').update(update).eq('id', id)
    .select('*, course_levels(count), course_enrollments(count)').single()

  if (error) {
    console.error('[api/courses PATCH]', error)
    return NextResponse.json({ error: 'Failed to update course' }, { status: 500 })
  }

  return NextResponse.json(data)
}

// DELETE /api/courses — delete course
export async function DELETE(request: Request) {
  let body: { id?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { id } = body
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const auth = await authorizeCourse(id)
  if ('error' in auth) return auth.error

  const { error } = await auth.admin.from('courses').delete().eq('id', id)
  if (error) {
    console.error('[api/courses DELETE]', error)
    return NextResponse.json({ error: 'Failed to delete course' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
