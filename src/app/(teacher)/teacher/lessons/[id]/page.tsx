export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { redirect, notFound } from 'next/navigation'
import { LessonDetailClient } from './lesson-detail-client'

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export default async function LessonDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: lesson }, { data: homework }, { data: groups }] = await Promise.all([
    adminClient()
      .from('lessons')
      .select('*, groups(id, name)')
      .eq('id', id)
      .eq('teacher_id', user.id)
      .single(),
    adminClient()
      .from('exams')
      .select('*, exam_submissions(count)')
      .eq('lesson_id', id)
      .eq('type', 'homework')
      .order('created_at', { ascending: true }),
    adminClient()
      .from('groups')
      .select('id, name')
      .eq('teacher_id', user.id),
  ])

  if (!lesson) notFound()

  return (
    <LessonDetailClient
      lesson={lesson}
      initialHomework={homework ?? []}
      groups={groups ?? []}
    />
  )
}
