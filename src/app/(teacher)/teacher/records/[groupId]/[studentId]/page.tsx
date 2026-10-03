export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import { buildItems, isShared, marksFor, progressFor, requestNow, summarize } from '@/lib/teacher-records'
import { loadGroupData } from '@/lib/data/teacher-records'
import { StudentRecordClient } from './student-record-client'

// Level 3: one student's complete record inside one of the teacher's groups.
// Both the group (owned by the teacher) and the membership are checked, so a
// guessed student id outside the group is a 404.
export default async function StudentRecordPage({ params, searchParams }: {
  params: Promise<{ groupId: string; studentId: string }>
  /** ?followup=<examId>: open the individual-task composer on that exam (from its results). */
  searchParams: Promise<{ followup?: string }>
}) {
  const { groupId, studentId } = await params
  const { followup } = await searchParams
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  // Only this student's roster row, submissions, marks and progress are read.
  const data = await loadGroupData(supabase, user.id, groupId, { studentId })
  if (!data) notFound()
  const member = data.members.find(m => m.studentId === studentId)
  if (!member) notFound()

  const items = buildItems(data.assessments, data.submissions.filter(s => s.studentId === studentId), member.joinedAt, requestNow(), studentId)
  const marks = marksFor(data, studentId)
  const progress = progressFor(data, studentId)

  return (
    <StudentRecordClient
      group={data.group}
      member={member}
      items={items}
      marks={marks}
      summary={summarize(items, marks, progress)}
      sources={data.assessments.filter(isShared).map(a => ({ id: a.id, title: a.title }))}
      followup={data.assessments.some(a => a.id === followup) ? followup : undefined}
    />
  )
}
