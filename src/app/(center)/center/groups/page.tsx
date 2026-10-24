export const dynamic = 'force-dynamic'

import { loadCenterAccess } from '@/lib/center-access'
import { run } from '@/lib/db/sql'
import { NoPermission } from '@/components/shared/no-permission'
import { CenterGroupsClient, type CenterGroupRow } from '@/components/center/groups-client'
import { activeTeacherName, type EmbeddedTeacher } from '@/lib/data/people'
import { loadCenterGroupsPage } from '@/lib/data/center-groups'

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

export default async function CenterGroupsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { userId, tenantId, has } = await loadCenterAccess()
  if (!has('manage_groups')) return <NoPermission capability="manage_groups" />

  // Teachers are found on demand (/api/teachers/search, ≤ 20 per search); the page
  // only needs each group's teacher name and whether any active teacher exists.
  // Students to add are found on demand in RosterModal (/api/roster/candidates, ≤ 20).
  // One page of groups (50), the active / archived totals, and every active group
  // for the transfer picker (lib/data/center-groups.ts).
  const { page: rawPage } = await searchParams
  const [list, [teacherCount, courseRows]] = await Promise.all([
    loadCenterGroupsPage(userId, tenantId, rawPage),
    run({ as: 'user', userId }, sql => [
      sql`select count(*)::int as n from public.users where tenant_id = ${tenantId} and role = 'teacher' and is_active`,
      sql`select id, title from public.courses where tenant_id = ${tenantId} order by title limit 1000`,
    ]),
  ])
  const activeTeachers = (teacherCount[0] as { n: number } | undefined)?.n ?? 0
  const courses = courseRows as unknown as { id: string; title: string | null }[]

  const rows: CenterGroupRow[] = (list.rows as unknown as RawGroup[]).map(g => ({
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
      // A new page is a new list: the client's local rows start from it.
      key={list.page}
      initialGroups={rows}
      summary={{ active: list.active, archived: list.archived }}
      page={list.page}
      pageCount={list.pageCount}
      transferOptions={list.transferOptions.map(o => ({
        id: o.id, name: o.name, course_id: o.course_id, max_students: o.max_students,
        student_count: o.group_students?.[0]?.count ?? 0,
      }))}
      hasTeachers={(activeTeachers ?? 0) > 0}
      courses={courses.map(c => ({ id: c.id, name: c.title || '—' }))}
    />
  )
}
