export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import { InvitationsClient } from '@/components/shared/invitations-client'

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export default async function TeacherInvitationsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Use admin client to bypass RLS helpers (current_tenant_id may return NULL
  // if fix_helper_search_path.sql has not been applied to the live DB).
  // Authorization is guaranteed by proxy (teacher role) + .eq('teacher_id', user.id).
  const { data: groups } = await adminClient()
    .from('groups')
    .select('id, name')
    .eq('teacher_id', user.id)
    .order('name')

  return (
    <InvitationsClient
      callerRole="teacher"
      tenants={[]}
      groups={groups ?? []}
    />
  )
}
