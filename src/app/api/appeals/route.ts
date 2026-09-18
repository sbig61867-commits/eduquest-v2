import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { rateLimit } from '@/lib/rate-limit'

// Student-filed disputes over a recorded proctoring violation, directed to
// the exam's teacher. See supabase/exam_appeals_migration.sql for the full
// design rationale (denormalized snapshots, one-appeal-per-event).
function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

interface ProctoringEventLike { type?: string; timestamp?: string }

// POST /api/appeals — a student disputes a recorded violation (or the exam's
// flagged status generally, if violation_type/violation_at are omitted).
// Body: { submissionId, violationType?, violationAt?, message }
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'غير مصرّح' }, { status: 401 })

  const { data: profile } = await supabase
    .from('users').select('role, tenant_id, full_name').eq('id', user.id).single()
  if (!profile || profile.role !== 'student' || !profile.tenant_id) {
    return NextResponse.json({ error: 'ممنوع' }, { status: 403 })
  }

  const rl = await rateLimit(`appeal:${user.id}`, { limit: 20, windowSecs: 3600 })
  if (!rl.allowed) {
    return NextResponse.json({ error: 'تجاوزت الحد المسموح، حاول لاحقاً' }, { status: 429 })
  }

  let body: { submissionId?: string; violationType?: string; violationAt?: string; message?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 }) }

  const { submissionId, violationType, violationAt } = body
  const message = body.message?.trim()
  if (!submissionId) return NextResponse.json({ error: 'submissionId مطلوب' }, { status: 400 })
  if (!message || message.length < 5) {
    return NextResponse.json({ error: 'يرجى كتابة تفاصيل الطعن (5 أحرف على الأقل)' }, { status: 400 })
  }
  if (message.length > 2000) {
    return NextResponse.json({ error: 'النص طويل جداً' }, { status: 400 })
  }

  const admin = adminClient()

  // The submission must belong to this student — service-role read since
  // students have no direct RLS SELECT on exam_submissions beyond their own
  // row, which this .eq() enforces anyway.
  const { data: submission } = await admin
    .from('exam_submissions')
    .select('id, exam_id, student_id, proctoring_events, exams(id, title, teacher_id, group_id, tenant_id, groups(name))')
    .eq('id', submissionId)
    .eq('student_id', user.id)
    .single()

  if (!submission) return NextResponse.json({ error: 'التسليم غير موجود' }, { status: 404 })

  const exam = submission.exams as unknown as {
    id: string; title: string; teacher_id: string; group_id: string; tenant_id: string
    groups: { name: string } | null
  } | null
  if (!exam) return NextResponse.json({ error: 'الاختبار غير موجود' }, { status: 404 })
  if (exam.tenant_id !== profile.tenant_id) return NextResponse.json({ error: 'ممنوع' }, { status: 403 })

  // If disputing a specific event, it must actually exist on this submission
  // — otherwise a student could file an appeal against a violation that was
  // never recorded, polluting the teacher's queue and the admin report.
  if (violationType || violationAt) {
    const events = (submission.proctoring_events as ProctoringEventLike[] | null) ?? []
    const found = events.some(e => e.type === violationType && e.timestamp === violationAt)
    if (!found) {
      return NextResponse.json({ error: 'لم يتم العثور على هذه المخالفة في سجل تسليمك' }, { status: 400 })
    }
  }

  const { data: teacher } = await admin.from('users').select('full_name').eq('id', exam.teacher_id).single()

  const { data: created, error } = await admin
    .from('exam_appeals')
    .insert({
      tenant_id: exam.tenant_id,
      exam_id: exam.id,
      submission_id: submissionId,
      student_id: user.id,
      teacher_id: exam.teacher_id,
      group_id: exam.group_id,
      violation_type: violationType ?? null,
      violation_at: violationAt ?? null,
      student_name: profile.full_name,
      teacher_name: teacher?.full_name ?? 'غير معروف',
      group_name: exam.groups?.name ?? 'غير معروف',
      exam_title: exam.title,
      student_message: message,
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'سبق أن قدّمت طعناً على هذه المخالفة' }, { status: 409 })
    }
    console.error('[api/appeals POST]', error)
    return NextResponse.json({ error: 'تعذّر إرسال الطعن' }, { status: 500 })
  }

  return NextResponse.json({ id: created.id }, { status: 201 })
}
