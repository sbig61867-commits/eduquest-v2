export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import { LessonsClient } from './lessons-client'

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export default async function LessonsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: lessons }, { data: groups }] = await Promise.all([
    adminClient().from('lessons').select('*, groups(name)').eq('teacher_id', user.id).order('created_at', { ascending: false }),
    adminClient().from('groups').select('id, name').eq('teacher_id', user.id),
  ])

  return <LessonsClient initialLessons={lessons ?? []} groups={groups ?? []} />
}
