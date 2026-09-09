export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { LessonDetailClient } from './lesson-detail-client'
import { PageTitle } from '@/components/shared/page-title'

export default async function LessonDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  const [{ data: lesson }, { data: homework }, { data: groups }] = await Promise.all([
    supabase
      .from('lessons')
      .select('*, groups(id, name)')
      .eq('id', id)
      .eq('teacher_id', user.id)
      .single(),
    supabase
      .from('exams')
      .select('*, exam_submissions(count)')
      .eq('lesson_id', id)
      .eq('type', 'homework')
      .order('created_at', { ascending: true }),
    supabase
      .from('groups')
      .select('id, name')
      .eq('teacher_id', user.id),
  ])

  if (!lesson) notFound()

  return (
    <>
      <PageTitle title={'Lesson'} />
      <LessonDetailClient
        lesson={lesson}
        initialHomework={homework ?? []}
        groups={groups ?? []}
      />
    </>
  )
}
