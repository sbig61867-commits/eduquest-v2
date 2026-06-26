export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { StudentProfileClient } from './profile-client'

export default async function StudentProfilePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('*, tenants(name, slug)')
    .eq('id', user.id)
    .single()

  const { data: groups } = await supabase
    .from('group_students')
    .select('groups(id, name, description, teacher:users!groups_teacher_id_fkey(full_name))')
    .eq('student_id', user.id)

  type GroupRow = { groups: { id: string; name: string; description: string | null; teacher: { full_name: string } | null } | null }
  const myGroups = (groups ?? [] as GroupRow[]).map((r: GroupRow) => r.groups).filter(Boolean)

  return <StudentProfileClient profile={profile} groups={myGroups} />
}
