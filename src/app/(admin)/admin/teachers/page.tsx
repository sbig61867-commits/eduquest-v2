export const dynamic = 'force-dynamic'

import { currentUser } from '@/lib/auth/current'
import { run } from '@/lib/db/sql'
import { redirect } from 'next/navigation'
import { TeachersClient } from './teachers-client'
import { listTeachers, parsePage, sanitizeSearch } from '@/lib/data/people'

// One page of the institution's teachers (PERFORMANCE_CONTRACT.md P1): search,
// page and total come from the database, never from filtering the whole
// teaching staff in the browser.
export default async function TeachersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const user = await currentUser()
  if (!user?.tenant_id) redirect('/login')

  const params = await searchParams
  const search = sanitizeSearch(params.q)
  const { data: list } = await listTeachers(user.id, user.tenant_id, { search, page: parsePage(params.page) })

  return (
    <TeachersClient
      initialTeachers={list.rows}
      total={list.total}
      page={list.page}
      pageCount={list.pageCount}
      search={search}
    />
  )
}
