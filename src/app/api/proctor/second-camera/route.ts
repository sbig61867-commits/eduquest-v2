import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { isUuid } from '@/lib/evidence-keys'
import { createSecondCameraToken } from '@/lib/second-camera-token'

// POST /api/proctor/second-camera  { examId }
// The student's own session asks for the phone link of THEIR running
// attempt (src/lib/second-camera-token.ts). Nothing is written.

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  let body: { examId?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }
  if (!isUuid(body.examId)) return NextResponse.json({ ...(await apiErr('missingFields')) }, { status: 400 })
  const examId = body.examId

  const admin = adminClient()
  const { data: exam } = await admin.from('exams').select('id, proctoring_enabled').eq('id', examId).maybeSingle()
  if (!exam?.proctoring_enabled) return NextResponse.json({ ...(await apiErr('examNotProctored')) }, { status: 404 })
  const { data: attempt } = await admin
    .from('exam_submissions').select('status').eq('exam_id', examId).eq('student_id', user.id).maybeSingle()
  if (attempt?.status !== 'in_progress') return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })

  return NextResponse.json({ path: `/cam/${createSecondCameraToken(examId, user.id)}` }, { headers: { 'Cache-Control': 'no-store' } })
}
