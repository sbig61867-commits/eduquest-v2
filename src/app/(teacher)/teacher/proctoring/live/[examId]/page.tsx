export const dynamic = 'force-dynamic'

import { currentUser } from '@/lib/auth/current'
import { run } from '@/lib/db/sql'
import { redirect } from 'next/navigation'
import { LiveMonitor } from './live-monitor'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function LiveProctoringPage({ params }: { params: Promise<{ examId: string }> }) {
  const { examId } = await params
  const user = await currentUser()
  if (!user) redirect('/login')

  const [rows] = UUID.test(examId)
    ? await run({ as: 'user', userId: user.id }, sql => [
        sql`select id, title, teacher_id, proctoring_enabled from public.exams where id = ${examId}`,
      ])
    : [[]]
  const exam = rows[0] as { id: string; title: string; teacher_id: string; proctoring_enabled: boolean } | undefined

  if (!exam || exam.teacher_id !== user.id || !exam.proctoring_enabled) {
    redirect('/teacher/proctoring')
  }

  const liveConfigured = !!(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY)

  // The page works without LiveKit too: who is in the exam, violation counts
  // and snapshots all come from the students' devices either way.
  return <LiveMonitor examId={exam.id} examTitle={exam.title} liveConfigured={liveConfigured} />
}
