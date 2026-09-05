import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

// Students no longer have direct SELECT on exams (answer-leak fix). Reading exam
// metadata here uses the service-role client; authorization is enforced
// separately by the enrollment check below.
function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

/**
 * POST /api/exam/start
 *
 * Records the authoritative server-side start time for a student's exam attempt.
 * Idempotent: calling again while in progress returns the existing start time
 * (so a refresh resumes rather than resets). Rejects if already submitted.
 *
 * This replaces the previous client-side upsert, which (a) could not write under
 * RLS and (b) let the client control the start time. Duration is now enforced by
 * the DB against this server timestamp.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { examId?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { examId } = body
  if (!examId) return NextResponse.json({ error: 'Missing examId' }, { status: 400 })

  // Verify the exam exists and is published, and resolve its tenant + group
  const { data: exam } = await adminClient()
    .from('exams')
    .select('id, tenant_id, group_id, starts_at, ends_at')
    .eq('id', examId)
    .eq('is_published', true)
    .single()

  if (!exam) return NextResponse.json({ error: 'Exam not found' }, { status: 404 })

  // Verify enrollment in the exam's group
  const { data: enrollment } = await supabase
    .from('group_students')
    .select('student_id')
    .eq('group_id', exam.group_id)
    .eq('student_id', user.id)
    .single()

  if (!enrollment) return NextResponse.json({ error: 'Not enrolled in this exam' }, { status: 403 })

  // Enforce the exam window at start time too (clear error before they begin)
  const now = Date.now()
  if (exam.starts_at && now < new Date(exam.starts_at).getTime()) {
    return NextResponse.json({ error: 'This exam is not open yet.' }, { status: 403 })
  }
  if (exam.ends_at && now > new Date(exam.ends_at).getTime()) {
    return NextResponse.json({ error: 'The exam window has closed.' }, { status: 403 })
  }

  // Via the service-role client so EXECUTE can be revoked from anon/authenticated
  // (see supabase migration): a student cannot start/spoof an attempt for another
  // student_id or an arbitrary tenant_id by calling the RPC directly.
  const { data: result, error } = await adminClient().rpc('start_exam_attempt', {
    p_exam_id: examId,
    p_student_id: user.id,
    p_tenant_id: exam.tenant_id,
  })

  if (error) {
    if (error.message?.includes('ALREADY_SUBMITTED')) {
      return NextResponse.json({ error: 'This exam has already been submitted.' }, { status: 409 })
    }
    console.error('[exam/start] error', error)
    return NextResponse.json({ error: 'Failed to start exam' }, { status: 500 })
  }

  if (
    !result ||
    typeof (result as Record<string, unknown>).started_at !== 'string' ||
    typeof (result as Record<string, unknown>).resumed !== 'boolean'
  ) {
    console.error('[exam/start] unexpected RPC result shape', result)
    return NextResponse.json({ error: 'Failed to start exam' }, { status: 500 })
  }
  const out = result as { started_at: string; resumed: boolean }
  return NextResponse.json({ startedAt: out.started_at, resumed: out.resumed })
}
