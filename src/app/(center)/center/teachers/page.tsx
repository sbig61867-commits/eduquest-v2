export const dynamic = 'force-dynamic'

import { loadCenterAccess } from '@/lib/center-access'
import { NoPermission } from '@/components/shared/no-permission'
import { PeopleClient } from '@/components/center/people-client'
import { teacherBlock } from '@/lib/account-scope'
import { listCenterTeachers, parsePage, sanitizeSearch } from '@/lib/data/people'

// One page of the institution's teachers (PERFORMANCE_CONTRACT.md P1): search,
// page, total and active count come from the database, and the lock is decided
// from the groups/courses of this page's teachers only (no whole-institution read).
export default async function CenterTeachersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const { supabase, tenantId, has } = await loadCenterAccess()
  if (!has('manage_teachers')) return <NoPermission capability="manage_teachers" />

  const params = await searchParams
  const search = sanitizeSearch(params.q)
  const { data: list } = await listCenterTeachers(supabase, tenantId, { search, page: parsePage(params.page) })

  return (
    <PeopleClient
      role="teacher"
      // The route re-checks the lock server-side; the page only mirrors it.
      initialPeople={list.rows.map(({ footprint, ...p }) => ({ ...p, locked: teacherBlock(footprint) }))}
      pagination={{ total: list.total, active: list.active ?? 0, page: list.page, pageCount: list.pageCount, search }}
    />
  )
}
