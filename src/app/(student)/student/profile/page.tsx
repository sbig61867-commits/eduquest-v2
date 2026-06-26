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

  type GroupItem = { id: string; name: string; description: string | null; teacher: { full_name: string } | { full_name: string }[] | null }
  type GroupRow = { groups: GroupItem | GroupItem[] | null }
  const myGroups = (groups ?? [] as GroupRow[]).map((r: GroupRow) => {
    const g = Array.isArray(r.groups) ? r.groups[0] : r.groups
    if (!g) return null
    const teacher = Array.isArray(g.teacher) ? g.teacher[0] : g.teacher
    return { id: g.id, name: g.name, description: g.description, teacher: teacher ? { full_name: teacher.full_name } : null }
  }).filter((g): g is NonNullable<typeof g> => g !== null)

  return <StudentProfileClient profile={profile} groups={myGroups} />
}
