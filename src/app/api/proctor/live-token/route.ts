import { currentCtx, serviceScopeFor } from '@/lib/auth/current'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne } from '@/lib/db/sql'
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk'
import { onRosterSql } from '@/lib/exam-roster'
import { WATCHING_ATTRIBUTE, parseWatching } from '@/lib/live-channel'


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

  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const user = { id: ctx.sub, email: ctx.email ?? undefined }

  let body: { examId?: string; role?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { examId, role } = body
  if (!examId || (role !== 'student' && role !== 'teacher')) {
    return NextResponse.json({ ...(await apiErr('missingExamOrRole')) }, { status: 400 })
  }

  // As app_service on the caller's institution (platform scope for the owner):
  // the exam, whether the caller is on its roster, and the caller's name. One unit.
  const scope = serviceScopeFor(ctx)
  if (!scope || !/^[0-9a-f-]{36}$/i.test(examId)) return NextResponse.json({ ...(await apiErr('examNotProctored')) }, { status: 404 })
  const [examRows, meRows] = await run(scope, sql => [
    sql`select e.teacher_id, e.proctoring_enabled, ${onRosterSql(sql, user.id)} as on_roster from public.exams e where e.id = ${examId}`,
    sql`select full_name from public.users where id = ${user.id}`,
  ])
  const exam = maybeOne<{ teacher_id: string; proctoring_enabled: boolean | null; on_roster: boolean }>(examRows)
  if (!exam || !exam.proctoring_enabled) {
    return NextResponse.json({ ...(await apiErr('examNotProctored')) }, { status: 404 })
  }
  const profile = { full_name: maybeOne<{ full_name: string | null }>(meRows)?.full_name ?? null, role: ctx.role }

  if (role === 'teacher') {
    if (exam.teacher_id !== user.id && profile?.role !== 'super_admin') {
      return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
    }
  } else {
    // Student must be on the exam's roster (its group, or its course).
    if (!exam.on_roster) return NextResponse.json({ ...(await apiErr('notEnrolledInExam')) }, { status: 403 })
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
