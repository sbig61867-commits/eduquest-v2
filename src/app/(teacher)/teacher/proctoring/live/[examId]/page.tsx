export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { LiveMonitor } from './live-monitor'

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

  return <LiveMonitor examId={exam.id} examTitle={exam.title} liveConfigured={liveConfigured} />
}
