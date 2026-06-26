import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// PATCH /api/admin/teacher-permissions
// Body: { teacher_id, can_create_courses }
// Allowed by: university_admin (own tenant) + super_admin (any tenant)
export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: caller } = await supabase
    .from('users').select('role, tenant_id').eq('id', user.id).single()

  if (!caller || !['super_admin', 'university_admin'].includes(caller.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { teacher_id?: string; can_create_courses?: boolean }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { teacher_id, can_create_courses } = body
  if (!teacher_id || typeof can_create_courses !== 'boolean') {
    return NextResponse.json({ error: 'teacher_id and can_create_courses are required' }, { status: 400 })
  }

  const adminClient = getAdminClient()

  // Verify the teacher belongs to the caller's tenant (unless super_admin)
  const { data: teacher } = await adminClient
    .from('users')
    .select('id, role, tenant_id, full_name')
    .eq('id', teacher_id)
    .single()

  if (!teacher || teacher.role !== 'teacher') {
    return NextResponse.json({ error: 'Teacher not found' }, { status: 404 })
  }

  if (caller.role === 'university_admin' && teacher.tenant_id !== caller.tenant_id) {
    return NextResponse.json({ error: 'Teacher is not in your university' }, { status: 403 })
  }

  const { error } = await adminClient
    .from('users')
    .update({ can_create_courses })
    .eq('id', teacher_id)

  if (error) {
    console.error('[teacher-permissions]', error)
    return NextResponse.json({ error: 'Failed to update teacher permissions' }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    teacher_id,
    can_create_courses,
    message: `${teacher.full_name} can ${can_create_courses ? 'now' : 'no longer'} create courses`,
  })
}
