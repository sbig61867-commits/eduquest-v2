import { currentCtx } from '@/lib/auth/current'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { loadProctoredAttempt } from '@/lib/proctoring-attempt'
import { isUuid } from '@/lib/evidence-keys'
import { createSecondCameraToken } from '@/lib/second-camera-token'

// POST /api/proctor/second-camera  { examId }
// The student's own session asks for the phone link of THEIR running
// attempt (src/lib/second-camera-token.ts). Nothing is written.


export async function POST(request: Request) {
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const user = { id: ctx.sub }

  let body: { examId?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }
  if (!isUuid(body.examId)) return NextResponse.json({ ...(await apiErr('missingFields')) }, { status: 400 })
  const examId = body.examId

  if (!ctx.tenant_id) return NextResponse.json({ ...(await apiErr('examNotProctored')) }, { status: 404 })
  // the exam (published, proctored) and the student's own attempt, one unit
  const { proctored, attempt } = await loadProctoredAttempt(ctx.tenant_id, examId, user.id)
  if (!proctored) return NextResponse.json({ ...(await apiErr('examNotProctored')) }, { status: 404 })
  if (attempt?.status !== 'in_progress') return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })

  return NextResponse.json({ path: `/cam/${createSecondCameraToken(examId, user.id, ctx.tenant_id)}` }, { headers: { 'Cache-Control': 'no-store' } })
}
