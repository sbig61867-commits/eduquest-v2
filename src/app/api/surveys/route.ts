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

async function resolveGroupOwnership(userId: string, groupId: string) {
  const supabase = await createClient()
  const { data: profile } = await supabase.from('users').select('role, tenant_id').eq('id', userId).single()
  if (!profile?.tenant_id || !['teacher', 'university_admin', 'super_admin'].includes(profile.role ?? '')) {
    return { error: 'Forbidden', status: 403, group: null }
  }
  const { data: group } = await adminClient().from('groups').select('id, teacher_id, tenant_id').eq('id', groupId).single()
  if (!group || group.tenant_id !== profile.tenant_id) return { error: 'Group not found', status: 404, group: null }
  if (profile.role === 'teacher' && group.teacher_id !== userId) return { error: 'Forbidden', status: 403, group: null }
  return { error: null, status: 200, group }
}

// GET /api/surveys?group_id=xxx — teacher/admin view: survey + response count
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const groupId = new URL(request.url).searchParams.get('group_id')
  if (!groupId) return NextResponse.json({ error: 'Missing group_id' }, { status: 400 })

  const { error, status } = await resolveGroupOwnership(user.id, groupId)
  if (error) return NextResponse.json({ error }, { status })

  const { data: survey } = await adminClient()
    .from('surveys').select('id, title, is_open, created_at').eq('group_id', groupId).maybeSingle()

  const [{ count: responseCount }, { count: memberCount }] = await Promise.all([
    survey
      ? adminClient().from('survey_responses').select('id', { count: 'exact', head: true }).eq('survey_id', survey.id)
      : Promise.resolve({ count: 0 }),
    adminClient().from('group_students').select('student_id', { count: 'exact', head: true }).eq('group_id', groupId),
  ])

  return NextResponse.json({ survey, responseCount: responseCount ?? 0, memberCount: memberCount ?? 0 })
}

// POST /api/surveys — create a survey for a group (teacher only, own group)
// Body: { group_id }
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { group_id?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const groupId = body.group_id
  if (!groupId) return NextResponse.json({ error: 'Missing group_id' }, { status: 400 })

  const { error, status, group } = await resolveGroupOwnership(user.id, groupId)
  if (error || !group) return NextResponse.json({ error }, { status })

  const { data, error: dbErr } = await adminClient()
    .from('surveys')
    .upsert(
      { group_id: groupId, tenant_id: group.tenant_id, teacher_id: group.teacher_id, is_open: true },
      { onConflict: 'group_id' }
    )
    .select('id, title, is_open, created_at')
    .single()

  if (dbErr) {
    console.error('[surveys POST]', dbErr)
    return NextResponse.json({ error: 'Failed to create survey' }, { status: 500 })
  }
  return NextResponse.json({ survey: data }, { status: 201 })
}

// PATCH /api/surveys — toggle open/closed
// Body: { group_id, is_open }
export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { group_id?: string; is_open?: boolean }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const { group_id: groupId, is_open } = body
  if (!groupId || typeof is_open !== 'boolean') return NextResponse.json({ error: 'Missing group_id or is_open' }, { status: 400 })

  const { error, status } = await resolveGroupOwnership(user.id, groupId)
  if (error) return NextResponse.json({ error }, { status })

  const { data, error: dbErr } = await adminClient()
    .from('surveys').update({ is_open }).eq('group_id', groupId)
    .select('id, title, is_open, created_at').single()

  if (dbErr) {
    console.error('[surveys PATCH]', dbErr)
    return NextResponse.json({ error: 'Failed to update survey' }, { status: 500 })
  }
  return NextResponse.json({ survey: data })
}
