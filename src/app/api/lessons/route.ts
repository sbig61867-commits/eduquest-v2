import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { deleteEntity } from '@/lib/delete-entity'
import { isLessonDocText, sanitizeLessonDoc, serializeLessonDoc } from '@/lib/lesson-doc'
import { isOwnLessonImage } from '@/lib/exam-files'

/**
 * Block lessons (src/lib/lesson-doc.ts) are re-validated here: the JSON is
 * rebuilt from known fields only, and an image block may only point at the
 * author's own uploads. Returns null for a malformed document. Markdown passes through.
 */
function cleanContent(content: string, tenantId: string, teacherId: string): string | null {
  if (!isLessonDocText(content)) return content
  let doc
  try { doc = sanitizeLessonDoc(JSON.parse(content)) } catch { return null }
  if (!doc) return null
  for (const s of doc.sections) {
    for (const b of s.blocks) if (b.type === 'image' && !isOwnLessonImage(b.path, tenantId, teacherId)) b.path = ''
  }
  return serializeLessonDoc(doc)
}

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
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  const profile = await getTeacherProfile(user.id)
  if (!profile?.tenant_id || !['teacher', 'university_admin', 'super_admin'].includes(profile.role ?? '')) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  let body: { title?: string; content?: string; group_id?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { title, group_id } = body
  const content = cleanContent(body.content ?? '', profile.tenant_id, user.id)
  if (content === null) return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
  if (!title?.trim() || !group_id) {
    return NextResponse.json({ ...(await apiErr('titleAndGroupRequired')) }, { status: 400 })
  }

  // Verify group belongs to this teacher in this tenant
  const { data: group } = await adminClient()
    .from('groups').select('id, teacher_id, tenant_id').eq('id', group_id).single()
  if (!group || group.tenant_id !== profile.tenant_id) {
    return NextResponse.json({ ...(await apiErr('groupNotFound')) }, { status: 404 })
  }
  if (profile.role === 'teacher' && group.teacher_id !== user.id) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  const { data, error } = await adminClient()
    .from('lessons')
    .insert({ title: title.trim(), content, group_id, teacher_id: user.id, tenant_id: profile.tenant_id })
    .select('*, groups(name)')
    .single()

  if (error) {
    console.error('[api/lessons POST]', error)
    return NextResponse.json({ ...(await apiErr('lessonCreateFailed')) }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}

// PATCH /api/lessons — update lesson
export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  const profile = await getTeacherProfile(user.id)
  if (!profile?.tenant_id) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })

  let body: { id?: string; title?: string; content?: string; is_published?: boolean }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { id, title, content, is_published } = body
  if (!id) return NextResponse.json({ ...(await apiErr('missingId')) }, { status: 400 })

  if (!(await ownsLesson(id, user.id, profile.tenant_id))) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  const update: Record<string, unknown> = {}
  if (title !== undefined) update.title = title.trim()
  if (content !== undefined) {
    const clean = cleanContent(content, profile.tenant_id, user.id)
    if (clean === null) return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
    update.content = clean
  }
  if (is_published !== undefined) update.is_published = is_published

  const { data, error } = await adminClient()
    .from('lessons').update(update).eq('id', id).select('*, groups(name)').single()

  if (error) {
    console.error('[api/lessons PATCH]', error)
    return NextResponse.json({ ...(await apiErr('lessonUpdateFailed')) }, { status: 500 })
  }

  return NextResponse.json(data)
}

// DELETE /api/lessons — delete lesson
export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  const profile = await getTeacherProfile(user.id)
  if (!profile?.tenant_id) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })

  let body: { id?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { id } = body
  if (!id) return NextResponse.json({ ...(await apiErr('missingId')) }, { status: 400 })

  if (!(await ownsLesson(id, user.id, profile.tenant_id))) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  // Archive by default; hard delete only when the owner enabled it.
  const { error, mode } = await deleteEntity(adminClient(), supabase, 'lesson', id, user.id, profile.tenant_id)
  if (error) {
    console.error('[api/lessons DELETE]', error)
    return NextResponse.json({ ...(await apiErr('lessonDeleteFailed')) }, { status: 500 })
  }
  return NextResponse.json({ ok: true, mode })
}
