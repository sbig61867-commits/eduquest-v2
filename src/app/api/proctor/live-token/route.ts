import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { AccessToken } from 'livekit-server-sdk'

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// One LiveKit room per proctored exam. Students publish (camera+mic) but do
// NOT subscribe (can't see each other). The exam's teacher subscribes to
// everyone but does not publish. Identity/authority are verified server-side.
function roomName(examId: string) { return `exam-${examId}` }

// POST /api/proctor/live-token  { examId, role: 'student' | 'teacher' }
export async function POST(request: Request) {
  const url = process.env.LIVEKIT_URL
  const key = process.env.LIVEKIT_API_KEY
  const secret = process.env.LIVEKIT_API_SECRET
  if (!url || !key || !secret || /^your/i.test(key)) {
    return NextResponse.json({ error: 'Live proctoring not configured' }, { status: 503 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { examId?: string; role?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { examId, role } = body
  if (!examId || (role !== 'student' && role !== 'teacher')) {
    return NextResponse.json({ error: 'Missing examId or role' }, { status: 400 })
  }

  const admin = adminClient()
  const { data: exam } = await admin
    .from('exams')
    .select('id, teacher_id, group_id, proctoring_enabled, is_published, starts_at, ends_at')
    .eq('id', examId)
    .is('deleted_at', null)
    .single()
  if (!exam || !exam.proctoring_enabled || !exam.is_published) {
    return NextResponse.json({ error: 'Exam not found or not available for proctoring' }, { status: 404 })
  }

  const { data: profile } = await admin
    .from('users').select('full_name, role').eq('id', user.id).single()
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 403 })

  if (role === 'teacher') {
    // Teachers/super admins may enter the published room before the window so
    // they can verify camera routing and have the monitor ready. They never
    // publish media to the room.
    if (exam.teacher_id !== user.id && profile.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  } else {
    // Students must be inside the teacher-defined exam window.
    const now = Date.now()
    if (exam.starts_at && now < new Date(exam.starts_at).getTime()) {
      return NextResponse.json({ error: 'This exam is not open yet.' }, { status: 403 })
    }
    if (exam.ends_at && now > new Date(exam.ends_at).getTime()) {
      return NextResponse.json({ error: 'The exam window has closed.' }, { status: 403 })
    }

    // A student may only receive a room token after the server has created the
    // in-progress attempt. This prevents joining/publishing before the exam
    // has actually started.
    const { data: enrollment } = await admin
      .from('group_students')
      .select('student_id')
      .eq('group_id', exam.group_id)
      .eq('student_id', user.id)
      .maybeSingle()
    if (!enrollment) return NextResponse.json({ error: 'Not enrolled in this exam' }, { status: 403 })

    const { data: attempt } = await admin
      .from('exam_submissions')
      .select('status')
      .eq('exam_id', examId)
      .eq('student_id', user.id)
      .maybeSingle()
    if (!attempt || attempt.status !== 'in_progress') {
      return NextResponse.json({ error: 'Start the exam before joining live proctoring.' }, { status: 409 })
    }
  }

  const isTeacher = role === 'teacher'
  const at = new AccessToken(key, secret, {
    identity: user.id,
    name: profile.full_name ?? user.email ?? 'user',
    ttl: '3h',
  })
  at.addGrant({
    room: roomName(examId),
    roomJoin: true,
    // Teacher watches only (subscribe); student streams only (publish) and
    // cannot subscribe, so students never see or hear each other.
    canPublish: !isTeacher,
    canSubscribe: isTeacher,
    canPublishData: false,
  })

  return NextResponse.json({ token: await at.toJwt(), url, room: roomName(examId) })
}
