export const dynamic = 'force-dynamic'

import { currentUser } from '@/lib/auth/current'
import { run } from '@/lib/db/sql'
import { redirect } from 'next/navigation'
import { StudentsClient } from './students-client'
import { canSetAffiliation } from '@/lib/student-affiliation'
import { getTenantSettings } from '@/lib/structure-mode'
import { listStudents, parsePage, sanitizeSearch } from '@/lib/data/people'

// One page of the institution's students (PERFORMANCE_CONTRACT.md P1): search,
// page and total come from the database, never from filtering the whole
// student body in the browser. name_complete rides on the same rows.
export default async function StudentsPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const user = await currentUser()
  if (!user) redirect('/login')

  if (!user.tenant_id) redirect('/login')

  const params = await searchParams
  const search = sanitizeSearch(params.q)
  const [{ data: list }, [profileRows], settings] = await Promise.all([
    listStudents(user.id, user.tenant_id, { search, page: parsePage(params.page) }),
    run({ as: 'user', userId: user.id }, sql => [sql`select role, permissions from public.users where id = ${user.id}`]),
    getTenantSettings(user.id, user.tenant_id),
  ])
  const profile = profileRows[0] as { role: string | null; permissions: Record<string, unknown> | null } | undefined

  return (
    <StudentsClient
      initialStudents={list.rows}
      total={list.total}
      page={list.page}
      pageCount={list.pageCount}
      search={search}
      canSetAffiliation={settings.has_center && canSetAffiliation(profile ?? { role: user.role, permissions: null })}
      hasCenter={settings.has_center}
    />
  )
}
