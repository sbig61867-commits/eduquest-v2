import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

// Auth/authz uses the user session (RLS-scoped).
// Writes use the admin client to bypass RLS — safe because authorization
// is fully enforced in application code above before any write happens.
// This pattern is necessary because current_user_role() / current_tenant_id()
// are SECURITY DEFINER helpers that may return NULL under PostgREST's
// restricted search_path if the DB migration hasn't been applied yet.
function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // ── Auth check (user session, RLS) ──────────────────────────
  const { data: profile } = await supabase
    .from('users')
    .select('role, tenant_id')
    .eq('id', user.id)
    .single()

  if (!profile?.tenant_id || !['teacher', 'university_admin', 'super_admin'].includes(profile.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { name?: string; description?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { name, description } = body
  if (!name?.trim()) return NextResponse.json({ error: 'Group name is required' }, { status: 400 })

  // ── Privileged write (admin client, bypasses RLS) ────────────
  const { data, error } = await adminClient()
    .from('groups')
    .insert({
      name: name.trim(),
      description: description?.trim() ?? null,
      teacher_id: user.id,
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
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // ── Auth check (user session, RLS) ──────────────────────────
  const { data: profile } = await supabase
    .from('users')
    .select('role, tenant_id')
    .eq('id', user.id)
    .single()

  if (!profile?.tenant_id || !['teacher', 'university_admin', 'super_admin'].includes(profile.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { id?: string; name?: string; description?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { id, name, description } = body
  if (!id || !name?.trim()) return NextResponse.json({ error: 'Missing id or name' }, { status: 400 })

  // ── Ownership check: verify group belongs to this tenant + teacher ──
  const { data: group } = await adminClient()
    .from('groups')
    .select('id, teacher_id, tenant_id')
    .eq('id', id)
    .single()

  if (!group || group.tenant_id !== profile.tenant_id) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 })
  }
  if (profile.role === 'teacher' && group.teacher_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // ── Privileged write (admin client, bypasses RLS) ────────────
  const { data, error } = await adminClient()
    .from('groups')
    .update({ name: name.trim(), description: description?.trim() ?? null })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('[api/groups PATCH]', error)
    return NextResponse.json({ error: 'Failed to update group' }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // ── Auth check (user session, RLS) ──────────────────────────
  const { data: profile } = await supabase
    .from('users')
    .select('role, tenant_id')
    .eq('id', user.id)
    .single()

  if (!profile?.tenant_id || !['teacher', 'university_admin', 'super_admin'].includes(profile.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { id?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { id } = body
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  // ── Ownership check: verify group belongs to this tenant + teacher ──
  const { data: group } = await adminClient()
    .from('groups')
    .select('id, teacher_id, tenant_id')
    .eq('id', id)
    .single()

  if (!group || group.tenant_id !== profile.tenant_id) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 })
  }
  if (profile.role === 'teacher' && group.teacher_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Grades are official records — deleting a group cascades through its
  // exams/homework to student submissions. Refuse when any exist.
  const { data: groupExams } = await adminClient()
    .from('exams').select('id').eq('group_id', id)
  if (groupExams && groupExams.length > 0) {
    const { count } = await adminClient()
      .from('exam_submissions')
      .select('id', { count: 'exact', head: true })
      .in('exam_id', groupExams.map(e => e.id))
    if ((count ?? 0) > 0) {
      return NextResponse.json(
        { error: `لا يمكن حذف المجموعة: يوجد ${count} تسليم بعلامات لاختباراتها وواجباتها. عطّل المجموعة (إلغاء التفعيل) بدلاً من حذفها للحفاظ على السجلات.` },
        { status: 409 }
      )
    }
  }

  // ── Privileged write (admin client, bypasses RLS) ────────────
  const { error } = await adminClient()
    .from('groups')
    .delete()
    .eq('id', id)

  if (error) {
    console.error('[api/groups DELETE]', error)
    return NextResponse.json({ error: 'Failed to delete group' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
