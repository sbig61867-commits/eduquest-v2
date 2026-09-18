import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { rateLimit } from '@/lib/rate-limit'

export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user: caller } } = await supabase.auth.getUser()
  if (!caller) return NextResponse.json({ error: 'غير مصرّح' }, { status: 401 })

  const { data: callerProfile } = await supabase
    .from('users').select('role, tenant_id').eq('id', caller.id).single()

  if (!callerProfile || !['university_admin', 'super_admin'].includes(callerProfile.role)) {
    return NextResponse.json({ error: 'ممنوع' }, { status: 403 })
  }

  // 20 deletions per admin per hour
  const rl = await rateLimit(`delete-user:${caller.id}`, { limit: 20, windowSecs: 3600 })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'تجاوزت الحد المسموح. حاول لاحقاً.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
    )
  }

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'المعرّف مفقود' }, { status: 400 })

  // Fetch target user to verify ownership and privilege ceiling
  const { data: targetProfile } = await supabase
    .from('users').select('role, tenant_id').eq('id', id).single()

  if (!targetProfile) return NextResponse.json({ error: 'لم يُعثر على المستخدم' }, { status: 404 })

  // university_admin can only delete users within their own tenant
  if (callerProfile.role === 'university_admin' && targetProfile.tenant_id !== callerProfile.tenant_id) {
    return NextResponse.json({ error: 'لا يمكن حذف مستخدمين من مؤسسات أخرى' }, { status: 403 })
  }

  // Cannot delete a user with equal or higher privilege
  const ROLE_RANK: Record<string, number> = { student: 0, teacher: 1, university_admin: 2, super_admin: 3 }
  if ((ROLE_RANK[targetProfile.role] ?? 0) >= (ROLE_RANK[callerProfile.role] ?? 0)) {
    return NextResponse.json({ error: 'لا يمكن حذف مستخدم بصلاحية مساوية أو أعلى' }, { status: 403 })
  }

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { error } = await admin.auth.admin.deleteUser(id)
  if (error) {
    console.error('[delete-user]', error)
    return NextResponse.json({ error: 'فشل حذف المستخدم' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
