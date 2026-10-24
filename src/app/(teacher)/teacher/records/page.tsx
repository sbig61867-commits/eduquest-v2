export const dynamic = 'force-dynamic'

import { currentUser } from '@/lib/auth/current'
import { redirect } from 'next/navigation'
import { requestNow } from '@/lib/teacher-records'
import { loadGroupCards } from '@/lib/data/teacher-records'
import { GroupsClient } from './groups-client'

// Level 1 of the student records: every group this teacher owns.
export default async function TeacherRecordsPage() {
  const user = await currentUser()
  if (!user) redirect('/login')

  const cards = await loadGroupCards(user.id, requestNow())
  return <GroupsClient cards={cards} />
}
