import { NextResponse } from 'next/server'
import { apiErr } from '@/lib/api-error'
import { currentUser } from '@/lib/auth/current'
import { run, maybeOne } from '@/lib/db/sql'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// GET /api/student/lesson-body?id=… — one lesson's body for /student/lessons,
// read the first time the student opens it (components/student/lesson-details.tsx).
// Read as the student: RLS (published lessons of their own groups) and the
// list's active-group filter decide exactly as for the list. A missing row and
// a refused row get the same answer.
export async function GET(request: Request) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const id = new URL(request.url).searchParams.get('id') ?? ''
  if (!UUID.test(id)) return NextResponse.json({ ...(await apiErr('notFound')) }, { status: 404 })

  try {
    const [rows] = await run({ as: 'user', userId: user.id }, sql => [
      sql`select l.content from public.lessons l join public.groups g on g.id = l.group_id where l.id = ${id} and g.is_active`,
    ])
    const lesson = maybeOne<{ content: string | null }>(rows)
    if (!lesson) return NextResponse.json({ ...(await apiErr('notFound')) }, { status: 404 })
    return NextResponse.json({ content: lesson.content ?? '' }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (e) {
    console.error('[student/lesson-body]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('unexpected')) }, { status: 500 })
  }
}
