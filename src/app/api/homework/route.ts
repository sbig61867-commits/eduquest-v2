import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { deleteEntity } from '@/lib/delete-entity'

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

async function getProfile(userId: string) {
  const supabase = await createClient()
  const { data } = await supabase.from('users').select('role, tenant_id').eq('id', userId).single()
  return data
}

async function getOwnedLesson(lessonId: string, teacherId: string, tenantId: string) {
  const { data } = await adminClient()
    .from('lessons').select('teacher_id, tenant_id, title').eq('id', lessonId).single()
  return data?.teacher_id === teacherId && data?.tenant_id === tenantId ? data : null
}

async function ownsHomework(hwId: string, teacherId: string, tenantId: string) {
  const { data } = await adminClient()
    .from('exams').select('teacher_id, tenant_id').eq('id', hwId).single()
  return data?.teacher_id === teacherId && data?.tenant_id === tenantId
}

// GET /api/homework?lesson_id=xxx  — list homework for a lesson
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const lessonId = searchParams.get('lesson_id')
  if (!lessonId) return NextResponse.json({ error: 'lesson_id required' }, { status: 400 })

  const profile = await getProfile(user.id)
  if (!profile?.tenant_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data, error } = await supabase
    .from('exams')
    .select('*, exam_submissions(count)')
    .eq('lesson_id', lessonId)
    .eq('type', 'homework')
    .eq('teacher_id', user.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: 'Failed to fetch homework' }, { status: 500 })
  return NextResponse.json(data ?? [])
}

// POST /api/homework — create homework for a lesson
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await getProfile(user.id)
  if (!profile?.tenant_id || !['teacher', 'university_admin', 'super_admin'].includes(profile.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { lesson_id?: string; group_id?: string; title?: string; questions?: unknown[]; due_date?: string; auto_publish?: boolean }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { lesson_id, group_id, title, questions, due_date, auto_publish } = body

  if (!lesson_id || !group_id || !title?.trim()) {
    return NextResponse.json({ error: 'lesson_id, group_id, and title are required' }, { status: 400 })
  }
  if (!Array.isArray(questions) || questions.length === 0) {
    return NextResponse.json({ error: 'At least one question is required' }, { status: 400 })
  }

  // Verify teacher owns the lesson
  const lesson = await getOwnedLesson(lesson_id, user.id, profile.tenant_id)
  if (!lesson) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Students see homework in lists detached from the lesson (exams page,
  // grades) — bake the lesson name into the title so it's always clear
  // which class session the homework belongs to.
  const cleanTitle = title.trim()
  const fullTitle = lesson.title && !cleanTitle.includes(lesson.title)
    ? `${cleanTitle}، درس: ${lesson.title}`
    : cleanTitle

  const row: Record<string, unknown> = {
    type: 'homework',
    lesson_id,
    group_id,
    teacher_id: user.id,
    tenant_id: profile.tenant_id,
    title: fullTitle,
    questions,
    // Homework is untimed for the student (timer hidden in the UI); this
    // large value only satisfies the finalize RPC's deadline check —
    // the real cutoff is ends_at (the due date).
    duration_minutes: 43200,
    ends_at: due_date ?? null,
    is_published: true,
    auto_publish: auto_publish !== false,
  }

  let { data, error } = await adminClient().from('exams').insert(row).select().single()

  // Graceful fallback while the auto_publish column migration hasn't been
  // applied — the submit route then treats missing as "enabled".
  if (error && /auto_publish/.test(error.message ?? '')) {
    delete row.auto_publish
    ;({ data, error } = await adminClient().from('exams').insert(row).select().single())
  }

  if (error) {
    console.error('[api/homework POST]', error)
    return NextResponse.json({ error: 'Failed to create homework' }, { status: 500 })
  }
  return NextResponse.json(data, { status: 201 })
}

// PATCH /api/homework — update (publish toggle or questions)
export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await getProfile(user.id)
  if (!profile?.tenant_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { id?: string; is_published?: boolean; title?: string; questions?: unknown[] }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { id, ...rest } = body
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  if (!(await ownsHomework(id, user.id, profile.tenant_id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const update: Record<string, unknown> = {}
  if (rest.is_published !== undefined) update.is_published = rest.is_published
  if (rest.title !== undefined) update.title = rest.title
  if (rest.questions !== undefined) update.questions = rest.questions

  const { data, error } = await adminClient()
    .from('exams').update(update).eq('id', id).select().single()

  if (error) return NextResponse.json({ error: 'Failed to update homework' }, { status: 500 })
  return NextResponse.json(data)
}

// DELETE /api/homework
export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await getProfile(user.id)
  if (!profile?.tenant_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { id?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!body.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  if (!(await ownsHomework(body.id, user.id, profile.tenant_id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Archive by default; hard delete only when the owner enabled it.
  const { error, mode } = await deleteEntity(adminClient(), supabase, 'exam', body.id, user.id, profile.tenant_id)
  if (error) {
    console.error('[api/homework DELETE]', error)
    return NextResponse.json({ error: 'Failed to delete homework' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, mode })
}
