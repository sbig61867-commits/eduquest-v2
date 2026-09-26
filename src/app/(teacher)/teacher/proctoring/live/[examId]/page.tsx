export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { LiveMonitor } from './live-monitor'
import { EvidencePanel } from './evidence-panel'

export default async function LiveProctoringPage({ params }: { params: Promise<{ examId: string }> }) {
  const { examId } = await params
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  const { data: exam } = await supabase
    .from('exams')
    .select('id, title, teacher_id, proctoring_enabled')
    .eq('id', examId)
    .single()

  if (!exam || exam.teacher_id !== user.id || !exam.proctoring_enabled) {
    redirect('/teacher/proctoring')
  }

  const liveConfigured = !!(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY)

  // The snapshot panel works even when LiveKit is not configured: violations
  // are captured on the student's device either way.
  return (
    <div className="grid xl:grid-cols-[minmax(0,1fr)_20rem] gap-6 items-start">
      <LiveMonitor examId={exam.id} examTitle={exam.title} liveConfigured={liveConfigured} />
      <EvidencePanel examId={exam.id} />
    </div>
  )
}
