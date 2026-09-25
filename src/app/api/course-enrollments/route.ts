import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient, staffCan } from '@/lib/staff-auth'

// Enrol / unenrol students in a structured course. Allowed for the course's
// own teacher, or staff holding manage_courses in the same tenant. Checked
// with the user session; written with the service-role client.

async function authorize(courseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 }) }

  const { data: profile } = await supabase
    .from('users').select('role, tenant_id, permissions').eq('id', user.id).single()
  if (!profile?.tenant_id) return { error: NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 }) }

  const admin = serviceClient()
  const { data: course } = await admin
    .from('courses').select('id, teacher_id, tenant_id').eq('id', courseId).is('deleted_at', null).maybeSingle()
  if (!course || course.tenant_id !== profile.tenant_id) {
    return { error: NextResponse.json({ ...(await apiErr('courseNotFound')) }, { status: 404 }) }
  }
  const staff = profile.role !== 'teacher' && staffCan(profile, 'manage_courses')
  if (course.teacher_id !== user.id && !staff) {
    return { error: NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 }) }
  }
  return { admin, tenantId: profile.tenant_id as string }
}

// GET /api/course-enrollments?course_id=…
export async function GET(request: Request) {
  const courseId = new URL(request.url).searchParams.get('course_id')
  if (!courseId) return NextResponse.json({ ...(await apiErr('missingCourseId')) }, { status: 400 })
  const auth = await authorize(courseId)
  if ('error' in auth) return auth.error

  const { data, error } = await auth.admin
    .from('course_enrollments')
    .select('student_id, enrolled_at, users!course_enrollments_student_id_fkey(id, full_name, email)')
    .eq('course_id', courseId)
    .order('enrolled_at', { ascending: false })
  if (error) {
    console.error('[course-enrollments GET]', error)
    return NextResponse.json({ ...(await apiErr('enrollmentsLoadFailed')) }, { status: 500 })
  }
  type U = { id: string; full_name: string; email: string }
  const students = ((data ?? []) as unknown as { users: U | U[] | null }[])
    .map(r => (Array.isArray(r.users) ? r.users[0] : r.users))
    .filter(Boolean)
  return NextResponse.json({ students })
}

// POST /api/course-enrollments { course_id, student_id }
export async function POST(request: Request) {
  let body: { course_id?: string; student_id?: string }
  try { body = await request.json() } catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }
  const { course_id, student_id } = body
  if (!course_id || !student_id) return NextResponse.json({ ...(await apiErr('missingCourseOrStudent')) }, { status: 400 })

  const auth = await authorize(course_id)
  if ('error' in auth) return auth.error
  const { admin, tenantId } = auth

  const { data: student } = await admin
    .from('users').select('id, full_name, email').eq('id', student_id)
    .eq('role', 'student').eq('tenant_id', tenantId).maybeSingle()
  if (!student) return NextResponse.json({ ...(await apiErr('studentNotInTenant')) }, { status: 404 })

  // Enrolment does not consume a plan seat — the seat is the account itself,
  // already capped in create-user / accept-invitation.
  const { error } = await admin
    .from('course_enrollments')
    .upsert({ course_id, student_id, tenant_id: tenantId }, { onConflict: 'course_id,student_id', ignoreDuplicates: true })
  if (error) {
    console.error('[course-enrollments POST]', error)
    return NextResponse.json({ ...(await apiErr('enrollFailed')) }, { status: 500 })
  }
  return NextResponse.json({ student }, { status: 201 })
}

// DELETE /api/course-enrollments { course_id, student_id }
export async function DELETE(request: Request) {
  let body: { course_id?: string; student_id?: string }
  try { body = await request.json() } catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }
  const { course_id, student_id } = body
  if (!course_id || !student_id) return NextResponse.json({ ...(await apiErr('missingCourseOrStudent')) }, { status: 400 })

  const auth = await authorize(course_id)
  if ('error' in auth) return auth.error

  const { error } = await auth.admin
    .from('course_enrollments').delete().eq('course_id', course_id).eq('student_id', student_id)
  if (error) {
    console.error('[course-enrollments DELETE]', error)
    return NextResponse.json({ ...(await apiErr('unenrollFailed')) }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
