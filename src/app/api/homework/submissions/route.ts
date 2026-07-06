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

// GET /api/homework/submissions?lesson_id=… — teacher's grading view.
// Returns each homework of the lesson with its submissions incl. student
// identity and answers, so the teacher can review essays and publish grades.
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const lessonId = new URL(request.url).searchParams.get('lesson_id')
  if (!lessonId) return NextResponse.json({ error: 'lesson_id required' }, { status: 400 })

  const admin = adminClient()
  const { data: exams } = await admin
    .from('exams')
    .select('id, title, questions, ends_at, created_at')
    .eq('lesson_id', lessonId)
    .eq('type', 'homework')
    .eq('teacher_id', user.id) // ownership: only the teacher's own homework
    .order('created_at', { ascending: true })

  if (!exams?.length) return NextResponse.json({ homework: [] })

  const { data: subs } = await admin
    .from('exam_submissions')
    .select('id, exam_id, student_id, answers, score, max_score, grading_status, submitted_at, users:student_id(full_name, email)')
    .in('exam_id', exams.map(e => e.id))
    .order('submitted_at', { ascending: true })

  const homework = exams.map(e => ({
    ...e,
    submissions: (subs ?? []).filter(s => s.exam_id === e.id).map(s => {
      const u = s.users as unknown as { full_name: string | null; email: string | null } | null
      return {
        id: s.id,
        student_name: u?.full_name ?? 'غير معروف',
        student_email: u?.email ?? '',
        answers: s.answers,
        score: s.score,
        max_score: s.max_score,
        grading_status: s.grading_status,
        submitted_at: s.submitted_at,
      }
    }),
  }))

  return NextResponse.json({ homework })
}

// PATCH /api/homework/submissions — save a manual grade and/or publish.
// Body: { id, score?, grading_status? }
export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { id?: string; score?: number; grading_status?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { id, score, grading_status } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  if (grading_status && !['pending', 'reviewing', 'published'].includes(grading_status)) {
    return NextResponse.json({ error: 'Invalid grading_status' }, { status: 400 })
  }

  const admin = adminClient()

  // Verify the submission belongs to one of this teacher's exams
  const { data: sub } = await admin
    .from('exam_submissions')
    .select('id, max_score, exams:exam_id(teacher_id)')
    .eq('id', id)
    .single()
  const owner = (sub?.exams as unknown as { teacher_id: string } | null)?.teacher_id
  if (!sub || owner !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const patch: Record<string, unknown> = {}
  if (typeof score === 'number') {
    if (score < 0 || (sub.max_score != null && score > sub.max_score)) {
      return NextResponse.json({ error: `Score must be between 0 and ${sub.max_score}` }, { status: 400 })
    }
    patch.score = score
    patch.is_graded = true
  }
  if (grading_status) patch.grading_status = grading_status
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { error } = await admin.from('exam_submissions').update(patch).eq('id', id)
  if (error) {
    console.error('[homework/submissions PATCH]', error)
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
