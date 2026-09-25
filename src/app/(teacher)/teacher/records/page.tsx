export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { loadGroupCards, requestNow } from '@/lib/teacher-records'
import { GroupsClient } from './groups-client'

// Level 1 of the student records: every group this teacher owns.
export default async function TeacherRecordsPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  const cards = await loadGroupCards(supabase, user.id, requestNow())
  return <GroupsClient cards={cards} />
}
