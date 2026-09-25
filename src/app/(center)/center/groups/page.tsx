export const dynamic = 'force-dynamic'

import { loadCenterAccess } from '@/lib/center-access'
import { NoPermission } from '@/components/shared/no-permission'
import { CenterGroupsClient, type CenterGroupRow } from '@/components/center/groups-client'

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
}

export default async function CenterGroupsPage() {
  const { supabase, tenantId, has } = await loadCenterAccess()
  if (!has('manage_groups')) return <NoPermission capability="manage_groups" />

  const [{ data: groups }, { data: teachers }, { data: students }, { data: courses }] = await Promise.all([
    supabase.from('groups')
      // `*` so the optional course/image/cap columns are simply absent pre-migration
      .select('*, group_students(count)')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false }),
    supabase.from('users').select('id, full_name')
      .eq('tenant_id', tenantId).eq('role', 'teacher').eq('is_active', true).order('full_name'),
    supabase.from('users').select('id, full_name')
      .eq('tenant_id', tenantId).eq('role', 'student').eq('is_active', true).order('full_name'),
    supabase.from('courses').select('id, title').eq('tenant_id', tenantId).order('title'),
  ])

  const rows: CenterGroupRow[] = ((groups ?? []) as unknown as RawGroup[]).map(g => ({
    id: g.id,
    name: g.name,
    description: g.description,
    is_active: g.is_active,
    teacher_id: g.teacher_id,
    student_count: g.group_students?.[0]?.count ?? 0,
    course_id: g.course_id ?? null,
    image_url: g.image_url ?? null,
    max_students: g.max_students ?? null,
    instructions: g.instructions ?? null,
  }))

  return (
    <CenterGroupsClient
      initialGroups={rows}
      teachers={(teachers ?? []).map(t => ({ id: t.id as string, name: (t.full_name as string) || '—' }))}
      students={(students ?? []).map(s => ({ id: s.id as string, name: (s.full_name as string) || '—' }))}
      courses={(courses ?? []).map(c => ({ id: c.id as string, name: (c.title as string) || '—' }))}
    />
  )
}
