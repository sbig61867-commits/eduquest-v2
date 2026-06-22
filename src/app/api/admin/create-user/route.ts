import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing SUPABASE env vars')
  return createAdminClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
}

function extractError(err: unknown): string {
  if (!err) return 'Unknown error'
  if (typeof err === 'string') return err
  const e = err as Record<string, unknown>
  const msg = (e.message as string) || (e.msg as string) || (e.error_description as string) || (e.code as string)
  if (msg) return msg
  const json = JSON.stringify(err)
  return (!json || json === '{}') ? 'Unknown error' : json
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user: caller } } = await supabase.auth.getUser()
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: callerProfile } = await supabase
      .from('users').select('role, tenant_id').eq('id', caller.id).single()

    if (!callerProfile || !['university_admin', 'super_admin'].includes(callerProfile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { full_name, email, password, role } = body

    if (!full_name?.trim() || !email?.trim() || !password || !role) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 })
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }

    const ALLOWED: Record<string, string[]> = {
      super_admin: ['university_admin', 'teacher', 'student'],
      university_admin: ['teacher', 'student'],
    }
    if (!ALLOWED[callerProfile.role]?.includes(role)) {
      return NextResponse.json({ error: `Your role cannot create a ${role} account` }, { status: 403 })
    }

    const tenant_id = callerProfile.role === 'super_admin'
      ? (body.tenant_id ?? null)
      : callerProfile.tenant_id

    if (!tenant_id) {
      return NextResponse.json({ error: 'A university must be selected for this role' }, { status: 400 })
    }

    const adminClient = getAdminClient()

    // Step 1: create the auth identity (trigger will insert a placeholder profile)
    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email: email.trim(),
      password,
      email_confirm: true,
      // No role/tenant_id in metadata — trigger now always defaults to 'student'/NULL
      user_metadata: { full_name: full_name.trim() },
    })

    if (authError) {
      console.error('[create-user] authError:', authError)
      return NextResponse.json({ error: extractError(authError) }, { status: 400 })
    }

    // Step 2: explicitly set role + tenant — never rely on the trigger for this.
    // Upsert handles the case where the trigger already inserted the row.
    const { data: profile, error: upsertError } = await adminClient
      .from('users')
      .upsert({
        id: authData.user.id,
        email: email.trim(),
        full_name: full_name.trim(),
        role,
        tenant_id,
        is_active: true,
      })
      .select('*')
      .single()

    if (upsertError) {
      console.error('[create-user] profile upsert error:', upsertError)
      // Rollback: delete the auth user so we don't leave orphaned auth entries
      await adminClient.auth.admin.deleteUser(authData.user.id)
      return NextResponse.json({ error: extractError(upsertError) }, { status: 400 })
    }

    return NextResponse.json({ user: profile })

  } catch (err) {
    console.error('[create-user] unexpected error:', err)
    return NextResponse.json({ error: extractError(err) }, { status: 500 })
  }
}

// Toggle is_active (super_admin only)
export async function PATCH(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user: caller } } = await supabase.auth.getUser()
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: callerProfile } = await supabase
      .from('users').select('role').eq('id', caller.id).single()
    if (callerProfile?.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id, is_active } = await request.json()
    if (!id || typeof is_active !== 'boolean') {
      return NextResponse.json({ error: 'Missing id or is_active' }, { status: 400 })
    }

    const { error } = await getAdminClient().from('users').update({ is_active }).eq('id', id)
    if (error) return NextResponse.json({ error: extractError(error) }, { status: 400 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: extractError(err) }, { status: 500 })
  }
}
