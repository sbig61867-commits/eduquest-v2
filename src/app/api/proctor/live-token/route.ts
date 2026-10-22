import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAdminDb } from '@/lib/db'
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk'
import { isOnExamRoster } from '@/lib/exam-roster'
import { WATCHING_ATTRIBUTE, parseWatching } from '@/lib/live-channel'

function adminClient() {
  return getAdminDb()
}

// One LiveKit room per proctored exam. Students publish (camera+mic) but do
// NOT subscribe (can't see each other). The exam's teacher subscribes to
// everyone but does not publish. Identity/authority are verified server-side.
//
// Live video is ON DEMAND: a student gets a token only while the exam's
// teacher is in the room AND lists that student in its `watching` attribute
// (asked of LiveKit itself, so a student cannot start streaming on its own or
// keep others streaming). Nobody streams — and no LiveKit minute is used —
// while no teacher is watching.
function roomName(examId: string) { return `exam-${examId}` }

/** LiveKit's HTTP API lives on the same host as its websocket URL. */
function apiHost(wsUrl: string) { return wsUrl.replace(/^ws(s?):\/\//, 'http$1://') }

async function teacherIsWatching(url: string, key: string, secret: string, room: string, teacherId: string, studentId: string) {
  try {
    const participants = await new RoomServiceClient(apiHost(url), key, secret).listParticipants(room)
    const teacher = participants.find(p => p.identity === teacherId)
    return !!teacher && parseWatching(teacher.attributes?.[WATCHING_ATTRIBUTE]).includes(studentId)
  } catch {
    return false // no room yet (nobody is watching) or LiveKit unreachable
  }
}

// POST /api/proctor/live-token  { examId, role: 'student' | 'teacher' }
export async function POST(request: Request) {
  const url = process.env.LIVEKIT_URL
  const key = process.env.LIVEKIT_API_KEY
  const secret = process.env.LIVEKIT_API_SECRET
  if (!url || !key || !secret || /^your/i.test(key)) {
    return NextResponse.json({ ...(await apiErr('liveNotConfigured')) }, { status: 503 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  let body: { examId?: string; role?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { examId, role } = body
  if (!examId || (role !== 'student' && role !== 'teacher')) {
    return NextResponse.json({ ...(await apiErr('missingExamOrRole')) }, { status: 400 })
  }

  const admin = adminClient()
  const { data: exam } = await admin
    .from('exams')
    .select('*')
    .eq('id', examId)
    .single()
  if (!exam || !exam.proctoring_enabled) {
    return NextResponse.json({ ...(await apiErr('examNotProctored')) }, { status: 404 })
  }

  const { data: profile } = await admin
    .from('users').select('full_name, role').eq('id', user.id).single()

  if (role === 'teacher') {
    if (exam.teacher_id !== user.id && profile?.role !== 'super_admin') {
      return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
    }
  } else {
    // Student must be on the exam's roster (its group, or its course).
    if (!(await isOnExamRoster(admin, exam, user.id))) return NextResponse.json({ ...(await apiErr('notEnrolledInExam')) }, { status: 403 })
    // ...and the teacher must be watching this student right now.
    if (!(await teacherIsWatching(url, key, secret, roomName(examId), exam.teacher_id, user.id))) {
      return NextResponse.json({ ...(await apiErr('liveNotWatching')) }, { status: 409 })
    }
  }

  const isTeacher = role === 'teacher'
  const at = new AccessToken(key, secret, {
    identity: user.id,
    name: profile?.full_name ?? user.email ?? 'user',
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
    // The teacher announces whom it watches through its own attributes.
    canUpdateOwnMetadata: isTeacher,
  })

  return NextResponse.json({
    token: await at.toJwt(), url, room: roomName(examId),
    identity: user.id, teacher: exam.teacher_id,
  })
}
