import { NextResponse } from 'next/server'
import { apiErr } from '@/lib/api-error'
import { currentUser } from '@/lib/auth/current'
import { run } from '@/lib/db/sql'

// GET /api/student/announcements — the student's live announcement feed for
// the dashboard popup (components/student/announcement-popup.tsx). Read as the
// student: get_student_announcements() decides audience, groups and the
// publish window, exactly as the dashboard page reads it.
export async function GET() {
  const user = await currentUser()
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  try {
    const [rows] = await run({ as: 'user', userId: user.id }, sql => [sql`select * from public.get_student_announcements()`])
    return NextResponse.json({ announcements: rows }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (e) {
    console.error('[student/announcements]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('unexpected')) }, { status: 500 })
  }
}
