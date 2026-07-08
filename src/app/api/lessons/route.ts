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

async function getTeacherProfile(userId: string) {
  const supabase = await createClient()
  const { data } = await supabase
    .from('users').select('role, tenant_id').eq('id', userId).single()
  return data
}

async function ownsLesson(lessonId: string, teacherId: string, tenantId: string) {
  const { data } = await adminClient()
    .from('lessons').select('id, teacher_id, tenant_id').eq('id', lessonId).single()
  return data && data.tenant_id === tenantId && data.teacher_id === teacherId
}

// POST /api/lessons — create lesson
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await getTeacherProfile(user.id)
  if (!profile?.tenant_id || !['teacher', 'university_admin', 'super_admin'].includes(profile.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { title?: string; content?: string; group_id?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { title, content, group_id } = body
  if (!title?.trim() || !group_id) {
    return NextResponse.json({ error: 'title and group_id are required' }, { status: 400 })
  }

  // Verify group belongs to this teacher in this tenant
  const { data: group } = await adminClient()
    .from('groups').select('id, teacher_id, tenant_id').eq('id', group_id).single()
  if (!group || group.tenant_id !== profile.tenant_id) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 })
  }
  if (profile.role === 'teacher' && group.teacher_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data, error } = await adminClient()
    .from('lessons')
    .insert({ title: title.trim(), content: content ?? '', group_id, teacher_id: user.id, tenant_id: profile.tenant_id })
    .select('*, groups(name)')
    .single()

  if (error) {
    console.error('[api/lessons POST]', error)
    return NextResponse.json({ error: 'Failed to create lesson' }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}

// PATCH /api/lessons — update lesson
export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await getTeacherProfile(user.id)
  if (!profile?.tenant_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { id?: string; title?: string; content?: string; is_published?: boolean }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { id, title, content, is_published } = body
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  if (!(await ownsLesson(id, user.id, profile.tenant_id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const update: Record<string, unknown> = {}
  if (title !== undefined) update.title = title.trim()
  if (content !== undefined) update.content = content
  if (is_published !== undefined) update.is_published = is_published

  const { data, error } = await adminClient()
    .from('lessons').update(update).eq('id', id).select('*, groups(name)').single()

  if (error) {
    console.error('[api/lessons PATCH]', error)
    return NextResponse.json({ error: 'Failed to update lesson' }, { status: 500 })
  }

  return NextResponse.json(data)
}

// DELETE /api/lessons — delete lesson
export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await getTeacherProfile(user.id)
  if (!profile?.tenant_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { id?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { id } = body
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  if (!(await ownsLesson(id, user.id, profile.tenant_id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Soft delete (archive): stamps the lesson and its homework as deleted;
  // submissions/grades stay intact and reachable from the archive.
  const { error } = await adminClient().rpc('soft_delete_entity', {
    p_kind: 'lesson', p_id: id, p_actor: user.id, p_tenant_id: profile.tenant_id,
  })
  if (error) {
    console.error('[api/lessons DELETE]', error)
    return NextResponse.json({ error: 'Failed to archive lesson' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
