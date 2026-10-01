export const dynamic = 'force-dynamic'

import { loadCenterAccess } from '@/lib/center-access'
import { NoPermission } from '@/components/shared/no-permission'
import { CenterGroupsClient, type CenterGroupRow } from '@/components/center/groups-client'
import { activeTeacherName, type EmbeddedTeacher } from '@/lib/data/people'

interface RawGroup {
  id: string
  name: string
  description: string | null
  is_active: boolean
  teacher_id: string
  // group_course_transfer_migration.sql — absent before it is applied
  course_id?: string | null
  image_url?: string | null
  max_students?: number | null
  instructions?: string | null
  group_students: { count: number }[] | null
  teacher: EmbeddedTeacher | EmbeddedTeacher[] | null
}

export default async function CenterGroupsPage() {
  const { supabase, tenantId, has } = await loadCenterAccess()
  if (!has('manage_groups')) return <NoPermission capability="manage_groups" />

  // Teachers are found on demand (/api/teachers/search, ≤ 20 per search); the page
  // only needs each group's teacher name and whether any active teacher exists.
  // Students to add are found on demand in RosterModal (/api/roster/candidates, ≤ 20).
  const [{ data: groups }, { count: activeTeachers }, { data: courses }] = await Promise.all([
    supabase.from('groups')
      // `*` so the optional course/image/cap columns are simply absent pre-migration
      .select('*, group_students(count), teacher:users!groups_teacher_id_fkey(full_name, role, is_active)')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false }),
    supabase.from('users').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq('role', 'teacher').eq('is_active', true),
    supabase.from('courses').select('id, title').eq('tenant_id', tenantId).order('title'),
  ])

  const rows: CenterGroupRow[] = ((groups ?? []) as unknown as RawGroup[]).map(g => ({
    id: g.id,
    name: g.name,
    description: g.description,
    is_active: g.is_active,
    teacher_id: g.teacher_id,
    teacher_name: activeTeacherName(g.teacher),
    student_count: g.group_students?.[0]?.count ?? 0,
    course_id: g.course_id ?? null,
    image_url: g.image_url ?? null,
    max_students: g.max_students ?? null,
    instructions: g.instructions ?? null,
  }))

  return (
    <CenterGroupsClient
      initialGroups={rows}
      hasTeachers={(activeTeachers ?? 0) > 0}
      courses={(courses ?? []).map(c => ({ id: c.id as string, name: (c.title as string) || '—' }))}
    />
  )
}
