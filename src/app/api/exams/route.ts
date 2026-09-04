import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import type { Question } from '@/types'
import { deleteEntity } from '@/lib/delete-entity'

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

async function ownsExam(examId: string, teacherId: string, tenantId: string) {
  const { data } = await adminClient()
    .from('exams').select('id, teacher_id, tenant_id').eq('id', examId).single()
  return data && data.tenant_id === tenantId && data.teacher_id === teacherId
}

function validateQuestions(questions: unknown): questions is Question[] {
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > 200) return false

  return questions.every((q) => {
    if (!q || typeof q !== 'object') return false
    const item = q as Record<string, unknown>
    if (typeof item.id !== 'string' || item.id.length < 1 || item.id.length > 100) return false
    if (typeof item.text !== 'string' || item.text.trim().length < 1 || item.text.length > 5000) return false
    if (!['mcq', 'true_false', 'short_answer', 'essay'].includes(String(item.type))) return false
    if (typeof item.correct_answer !== 'string' || item.correct_answer.length > 5000) return false
    if (typeof item.points !== 'number' || !Number.isFinite(item.points) || item.points <= 0 || item.points > 1000) return false

    if (item.type === 'mcq') {
      return Array.isArray(item.options) && item.options.length === 4 &&
        item.options.every((option) => typeof option === 'string' && option.trim().length > 0 && option.length <= 2000) &&
        (item.options as string[]).includes(item.correct_answer as string)
    }
    if (item.type === 'true_false') {
      return Array.isArray(item.options) && item.options.length === 2 &&
        item.options[0] === 'True' && item.options[1] === 'False' &&
        (item.correct_answer === 'True' || item.correct_answer === 'False')
    }

    // Written-response questions are manually graded; no option list is needed.
    return item.options === undefined || (Array.isArray(item.options) && item.options.length === 0)
  })
}

function validateDuration(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 1440
}

// POST /api/exams — create exam
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await getTeacherProfile(user.id)
  if (!profile?.tenant_id || !['teacher', 'university_admin', 'super_admin'].includes(profile.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { title?: string; group_id?: string; duration_minutes?: number; proctoring_enabled?: boolean; questions?: Question[] }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { title, group_id, duration_minutes, proctoring_enabled, questions } = body
  if (!title?.trim() || !group_id) {
    return NextResponse.json({ error: 'title and group_id are required' }, { status: 400 })
  }
  if (title.trim().length > 200) return NextResponse.json({ error: 'Title is too long (max 200 characters)' }, { status: 400 })

  const duration = duration_minutes ?? 60
  if (!validateDuration(duration)) {
    return NextResponse.json({ error: 'Duration must be an integer between 1 and 1440 minutes' }, { status: 400 })
  }
  if (questions !== undefined && !validateQuestions(questions)) {
    return NextResponse.json({ error: 'Invalid questions. Exams require 1–200 valid questions.' }, { status: 400 })
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

  const safeQuestions = questions ?? []
  const { data, error } = await adminClient()
    .from('exams')
    .insert({
      type: 'exam',
      title: title.trim(),
      group_id,
      teacher_id: user.id,
      tenant_id: profile.tenant_id,
      duration_minutes: duration,
      proctoring_enabled: proctoring_enabled ?? false,
      questions: safeQuestions,
    })
    .select('*, groups(name)')
    .single()

  if (error) {
    console.error('[api/exams POST]', error)
    return NextResponse.json({ error: 'Failed to create exam' }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}

// PATCH /api/exams — update exam (publish/unpublish or edit)
export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await getTeacherProfile(user.id)
  if (!profile?.tenant_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { id?: string; is_published?: boolean; title?: string; duration_minutes?: number }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { id, ...rest } = body
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  if (!(await ownsExam(id, user.id, profile.tenant_id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const update: Record<string, unknown> = {}
  if (rest.is_published !== undefined) {
    if (typeof rest.is_published !== 'boolean') return NextResponse.json({ error: 'is_published must be boolean' }, { status: 400 })
    if (rest.is_published) {
      const { data: current } = await adminClient()
        .from('exams').select('questions').eq('id', id).single()
      if (!current || !validateQuestions(current.questions)) {
        return NextResponse.json({ error: 'An exam must contain 1–200 valid questions before it can be published.' }, { status: 400 })
      }
    }
    update.is_published = rest.is_published
  }
  if (rest.title !== undefined) {
    if (typeof rest.title !== 'string' || !rest.title.trim() || rest.title.trim().length > 200) {
      return NextResponse.json({ error: 'Title must be between 1 and 200 characters' }, { status: 400 })
    }
    update.title = rest.title.trim()
  }
  if (rest.duration_minutes !== undefined) {
    if (!validateDuration(rest.duration_minutes)) {
      return NextResponse.json({ error: 'Duration must be an integer between 1 and 1440 minutes' }, { status: 400 })
    }
    update.duration_minutes = rest.duration_minutes
  }

  if (Object.keys(update).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const { data, error } = await adminClient()
    .from('exams').update(update).eq('id', id).select('*, groups(name)').single()

  if (error) {
    console.error('[api/exams PATCH]', error)
    return NextResponse.json({ error: 'Failed to update exam' }, { status: 500 })
  }

  return NextResponse.json(data)
}

// DELETE /api/exams — delete exam
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

  if (!(await ownsExam(id, user.id, profile.tenant_id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Archive by default; hard delete only when the owner enabled it.
  const { error, mode } = await deleteEntity(adminClient(), supabase, 'exam', id, user.id, profile.tenant_id)
  if (error) {
    console.error('[api/exams DELETE]', error)
    return NextResponse.json({ error: 'Failed to delete exam' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, mode })
}
