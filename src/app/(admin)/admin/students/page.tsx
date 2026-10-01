export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { StudentsClient } from './students-client'
import { canSetAffiliation } from '@/lib/student-affiliation'
import { getTenantSettings } from '@/lib/structure-mode'
import { listStudents, parsePage, sanitizeSearch } from '@/lib/data/people'

// One page of the institution's students (PERFORMANCE_CONTRACT.md P1): search,
// page and total come from the database, never from filtering the whole
// student body in the browser. name_complete rides on the same rows.
export default async function StudentsPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  if (!user.tenant_id) redirect('/login')

  const params = await searchParams
  const search = sanitizeSearch(params.q)
  const [{ data: list }, { data: profile }, settings] = await Promise.all([
    listStudents(supabase, user.tenant_id, { search, page: parsePage(params.page) }),
    supabase.from('users').select('role, permissions').eq('id', user.id).single(),
    getTenantSettings(supabase, user.tenant_id),
  ])

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
