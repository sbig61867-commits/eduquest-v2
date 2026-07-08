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

// GET /api/exams/results?exam_id=…  — results for one exam (teacher-owned):
// who submitted, their score, grading status, proctoring flags, plus the
// full group roster so the teacher sees who hasn't taken it yet.
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const examId = new URL(request.url).searchParams.get('exam_id')
  if (!examId) return NextResponse.json({ error: 'exam_id required' }, { status: 400 })

  const admin = adminClient()
  const { data: exam } = await admin
    .from('exams')
    .select('id, title, teacher_id, group_id, questions, groups(name)')
    .eq('id', examId)
    .single()
  if (!exam || exam.teacher_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const maxScore = ((exam.questions as Array<{ points?: number }>) ?? [])
    .reduce((s, q) => s + (q.points ?? 0), 0)

  const [{ data: subs }, { data: roster }] = await Promise.all([
    admin.from('exam_submissions')
      .select('student_id, score, max_score, grading_status, submitted_at, proctoring_events, users:student_id(full_name, email)')
      .eq('exam_id', examId),
    admin.from('group_students')
      .select('student_id, users:student_id(full_name, email)')
      .eq('group_id', exam.group_id),
  ])

  const subByStudent = new Map((subs ?? []).map(s => [s.student_id, s]))

  // One row per enrolled student — submitted or not.
  const results = (roster ?? []).map(r => {
    const u = r.users as unknown as { full_name: string | null; email: string | null } | null
    const s = subByStudent.get(r.student_id)
    const events = (s?.proctoring_events as unknown[] | null) ?? []
    return {
      student_id: r.student_id,
      name: u?.full_name ?? 'غير معروف',
      email: u?.email ?? '',
      submitted: !!s,
      score: s?.score ?? null,
      max_score: s?.max_score ?? maxScore,
      grading_status: s?.grading_status ?? null,
      submitted_at: s?.submitted_at ?? null,
      violations: events.length,
    }
  })
  // Submitted first, then by score desc.
  results.sort((a, b) => Number(b.submitted) - Number(a.submitted) || (b.score ?? -1) - (a.score ?? -1))

  const groupName = (exam.groups as unknown as { name: string } | null)?.name ?? '—'
  return NextResponse.json({
    title: exam.title, group_name: groupName, max_score: maxScore,
    submitted_count: subs?.length ?? 0, roster_count: roster?.length ?? 0,
    results,
  })
}
