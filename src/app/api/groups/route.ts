import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

  const { data, error } = await supabase
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
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

  // Verify the group belongs to this tenant and — for teachers — to themselves
  const { data: group } = await supabase
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

  const { data, error } = await supabase
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

  // Verify the group belongs to this tenant and — for teachers — to themselves
  const { data: group } = await supabase
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

  const { error } = await supabase
    .from('groups')
    .delete()
    .eq('id', id)

  if (error) {
    console.error('[api/groups DELETE]', error)
    return NextResponse.json({ error: 'Failed to delete group' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
