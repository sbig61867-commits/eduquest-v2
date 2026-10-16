import { NextResponse } from 'next/server'
import { apiErr } from '@/lib/api-error'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import { summarizeLesson } from '@/lib/assistant/lesson-summary'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// GET /api/assistant/student/summary?lessonId=<uuid>
// A structured summary built from the lesson's own blocks (lesson-summary.ts).
// The lesson is read through the student's session: RLS returns it only when
// it is published and in one of the student's active groups. No AI provider
// is called and quiz answers are never read.
export async function GET(request: Request) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  if (user.role !== 'student') return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })

  const lessonId = new URL(request.url).searchParams.get('lessonId') ?? ''
  if (!UUID_RE.test(lessonId)) return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })

  const { data: lesson } = await supabase
    .from('lessons')
    .select('id, title, content')
    .eq('id', lessonId)
    .eq('is_published', true)
    .is('deleted_at', null)
    .maybeSingle()
  // A missing row and a forbidden row get the same answer.
  if (!lesson) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })

  const row = lesson as { id: string; title: string; content: string | null }
  return NextResponse.json(
    { lessonId: row.id, summary: summarizeLesson(row.title, row.content) },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
