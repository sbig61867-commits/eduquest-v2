import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { extOf, isExpired, parseEvidenceKey } from '@/lib/evidence-keys'
import { contentTypeFor, getEvidence } from '@/lib/evidence-store'

// GET /api/proctor/evidence/image?key=…  — one evidence snapshot, for the
// exam's own teacher only, and only before its 30-hour expiry. Used with the
// Workers KV backend, whose REST API (and token) must never reach a browser.
// The bytes are never cached beyond the teacher's own browser session.
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse(null, { status: 401 })

  const parsed = parseEvidenceKey(new URL(request.url).searchParams.get('key') ?? '')
  if (!parsed || isExpired(parsed.capturedAt)) return new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'no-store' } })

  const { data: exam } = await supabase.from('exams').select('teacher_id').eq('id', parsed.examId).maybeSingle()
  if (!exam || exam.teacher_id !== user.id) return new NextResponse(null, { status: 403 })

  const bytes = await getEvidence(parsed.key)
  // KV is eventually consistent: a snapshot written seconds ago may not be readable yet.
  if (!bytes) return new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'no-store' } })

  return new NextResponse(bytes as BodyInit, {
    headers: {
      'Content-Type': contentTypeFor(extOf(parsed.key)),
      'Cache-Control': 'private, max-age=600',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
