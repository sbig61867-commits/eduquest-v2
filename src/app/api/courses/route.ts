import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

async function getProfile(userId: string) {
  const supabase = await createClient()
  const { data } = await supabase
    .from('users').select('role, tenant_id, can_create_courses').eq('id', userId).single()
  return data
}

// POST /api/courses — create course
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await getProfile(user.id)
  if (!profile?.tenant_id || !profile.can_create_courses) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { title?: string; description?: string; language?: string; has_levels?: boolean }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { title, description, language, has_levels } = body
  if (!title?.trim()) return NextResponse.json({ error: 'Title is required' }, { status: 400 })

  const { data, error } = await adminClient()
    .from('courses')
    .insert({
      title: title.trim(),
      description: description || null,
      language: language || null,
      has_levels: has_levels ?? true,
      teacher_id: user.id,
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

// PATCH /api/courses — update course (publish toggle or edit)
export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await getProfile(user.id)
  if (!profile?.tenant_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { id?: string; is_published?: boolean; title?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { id, ...rest } = body
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  // Ownership check
  const { data: course } = await adminClient()
    .from('courses').select('teacher_id, tenant_id').eq('id', id).single()
  if (!course || course.tenant_id !== profile.tenant_id || course.teacher_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const update: Record<string, unknown> = {}
  if (rest.is_published !== undefined) update.is_published = rest.is_published
  if (rest.title !== undefined) update.title = rest.title

  const { data, error } = await adminClient()
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
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await getProfile(user.id)
  if (!profile?.tenant_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { id?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { id } = body
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const { data: course } = await adminClient()
    .from('courses').select('teacher_id, tenant_id').eq('id', id).single()
  if (!course || course.tenant_id !== profile.tenant_id || course.teacher_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { error } = await adminClient().from('courses').delete().eq('id', id)
  if (error) {
    console.error('[api/courses DELETE]', error)
    return NextResponse.json({ error: 'Failed to delete course' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
