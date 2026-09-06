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

const KINDS = new Set(['group', 'lesson', 'exam', 'course'])

// POST /api/admin/restore — un-archive an entity (university_admin / super_admin).
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('users').select('role, tenant_id').eq('id', user.id).single()
  if (!profile?.tenant_id || !['university_admin', 'super_admin'].includes(profile.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { kind?: string; id?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!body.id || !body.kind || !KINDS.has(body.kind)) {
    return NextResponse.json({ error: 'Missing or invalid kind/id' }, { status: 400 })
  }

  const { error } = await adminClient().rpc('restore_entity', {
    p_kind: body.kind, p_id: body.id, p_tenant_id: profile.tenant_id, p_actor: user.id,
  })
  if (error) {
    console.error('[api/admin/restore]', error)
    return NextResponse.json({ error: 'Failed to restore' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
