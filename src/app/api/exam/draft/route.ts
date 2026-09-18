import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

/**
 * POST /api/exam/draft
 *
 * Saves the student's in-progress answers server-side so they can resume
 * from a different device. Only works while the attempt is 'in_progress'.
 * Only for timed exams (homework doesn't need this — it has no time pressure).
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'غير مصرّح' }, { status: 401 })

  let body: { examId?: string; answers?: Record<string, string> }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 }) }

  const { examId, answers } = body
  if (!examId || !answers || typeof answers !== 'object') {
    return NextResponse.json({ error: 'معرّف الاختبار أو الإجابات مفقودة' }, { status: 400 })
  }

  // Only update if the attempt is still in_progress (never overwrite a submitted attempt)
  const { error } = await adminClient()
    .from('exam_submissions')
    .update({ answers_draft: answers })
    .eq('exam_id', examId)
    .eq('student_id', user.id)
    .eq('grading_status', 'in_progress')

  if (error) {
    console.error('[exam/draft] error', error)
    return NextResponse.json({ error: 'فشل حفظ المسودة' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
