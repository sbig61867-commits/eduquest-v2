export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import { groupStudentRows, loadGroupData, requestNow, summarizeAttendance } from '@/lib/teacher-records'
import { GroupRecordClient, type AssessmentBar } from './group-record-client'

const CHART_LAST = 12

// Level 2: one of the teacher's groups. Another teacher's group (or a guessed
// id) is a 404 — loadGroupData only returns groups this teacher owns.
export default async function GroupRecordPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  const data = await loadGroupData(supabase, user.id, groupId)
  if (!data) notFound()

  const now = requestNow()
  const rows = groupStudentRows(data, now)

  // Per-assessment average over the group's graded submissions, oldest first.
  const memberIds = new Set(data.members.map(m => m.studentId))
  const bars: AssessmentBar[] = [...data.assessments]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-CHART_LAST)
    .map(a => {
      const pcts = data.submissions
        .filter(s => s.examId === a.id && memberIds.has(s.studentId) && s.status === 'submitted' && s.score != null)
        .flatMap(s => {
          const max = s.maxScore ?? a.maxPoints
          return max ? [Math.round((s.score! / max) * 100)] : []
        })
      return {
        id: a.id, title: a.title, kind: a.kind, createdAt: a.createdAt, count: pcts.length,
        avg: pcts.length ? Math.round(pcts.reduce((x, y) => x + y, 0) / pcts.length) : null,
      }
    })

  const averages = rows.flatMap(r => (r.summary.overallAvg == null ? [] : [r.summary.overallAvg]))
  const completions = rows.flatMap(r => (r.summary.completion == null ? [] : [r.summary.completion]))
  const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, x) => a + x, 0) / xs.length) : null)

  return (
    <GroupRecordClient
      group={data.group}
      rows={rows}
      bars={bars}
      hasCourseProgress={!!data.progress}
      stats={{
        students: data.members.length,
        avg: mean(averages),
        completion: mean(completions),
        attendance: summarizeAttendance(data.marks.map(m => ({ sessionId: m.sessionId, date: '', title: null, status: m.status, note: null }))).rate,
        atRisk: rows.filter(r => r.summary.atRisk).length,
      }}
    />
  )
}
