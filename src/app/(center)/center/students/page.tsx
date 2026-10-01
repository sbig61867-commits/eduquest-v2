export const dynamic = 'force-dynamic'

import { loadCenterAccess } from '@/lib/center-access'
import { NoPermission } from '@/components/shared/no-permission'
import { PeopleClient } from '@/components/center/people-client'
import { studentBlock } from '@/lib/account-scope'
import { listCenterStudents, parsePage, sanitizeSearch } from '@/lib/data/people'

// One page of the institution's students (PERFORMANCE_CONTRACT.md P1): search,
// page, total and active count come from the database; name_complete rides on
// the same rows (no second whole read of the student body).
export default async function CenterStudentsPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const { supabase, tenantId, has } = await loadCenterAccess()
  if (!has('manage_students')) return <NoPermission capability="manage_students" />

  const params = await searchParams
  const search = sanitizeSearch(params.q)
  const { data: list } = await listCenterStudents(supabase, tenantId, { search, page: parsePage(params.page) })

  return (
    <PeopleClient
      role="student"
      initialPeople={list.rows.map(p => ({
        ...p,
        is_university_student: p.is_university_student ?? undefined,
        locked: studentBlock(p.is_university_student),
      }))}
      pagination={{ total: list.total, active: list.active ?? 0, page: list.page, pageCount: list.pageCount, search }}
      canSetAffiliation={has('announce_to_university')}
    />
  )
}
