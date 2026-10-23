import { NextResponse } from 'next/server'
import { apiErr } from '@/lib/api-error'
import { currentUser } from '@/lib/auth/current'
import { run } from '@/lib/db/sql'
import { studentExamListSql, toStudentExams } from '@/lib/data/student-exams'

// GET /api/student/quick-access — the student side panel: a few course titles,
// the latest lessons of the student's ACTIVE groups and the next exam titles.
// ONE unit, read as the student (RLS decides, as on their pages); the panel
// used to make four reads from the browser.
export async function GET() {
  const user = await currentUser()
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  if (user.role !== 'student') return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })

  try {
    const [courses, lessons, exams] = await run({ as: 'user', userId: user.id }, sql => [
      sql`select c.id, c.title from public.courses c
           where c.is_published
             and c.id in (select course_id from public.course_enrollments where student_id = ${user.id})
           order by c.title limit 6`,
      sql`select l.id, l.title from public.lessons l join public.groups g on g.id = l.group_id
           where l.is_published and g.is_active
             and l.group_id in (select group_id from public.group_students where student_id = ${user.id})
           order by l.created_at desc limit 5`,
      // Metadata only: the panel shows five titles.
      studentExamListSql(sql),
    ])
    return NextResponse.json(
      {
        courses,
        lessons,
        exams: toStudentExams(exams).slice(0, 5).map(e => ({ id: e.id, title: e.title, due_date: e.ends_at })),
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  } catch (e) {
    console.error('[student/quick-access]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('unexpected')) }, { status: 500 })
  }
}
