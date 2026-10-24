import { currentUser } from '@/lib/auth/current'
import { run, maybeOne } from '@/lib/db/sql'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { isOwnLessonImage, isUuid, signFileMap } from '@/lib/exam-files'
import { imagePaths, parseLessonContent } from '@/lib/lesson-doc'

// GET /api/lessons/media?lesson=<id> | ?item=<course unit item id> — signed
// links for the image blocks of a lesson or of a course content item.
// The row is read AS THE CALLER, so RLS decides who may see it
// (its teacher, a student of the group / an enrolled student once published …)
// exactly as for the body itself. Only lesson-image paths of the row's own
// tenant are signed: a lesson's must be its teacher's uploads; a course item's
// may be any staff member's in that tenant (staff edit courses too).
const LESSON_IMAGE = /^[0-9a-f-]{36}\/lessons\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp|gif)$/i

export async function GET(request: Request) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const asUser = { as: 'user' as const, userId: user.id }

  const params = new URL(request.url).searchParams
  const lessonId = params.get('lesson')
  const itemId = params.get('item')
  let paths: string[] = []

  if (isUuid(lessonId)) {
    const [rows] = await run(asUser, sql => [sql`select content, tenant_id, teacher_id from public.lessons where id = ${lessonId}`])
    const lesson = maybeOne<{ content: string | null; tenant_id: string; teacher_id: string }>(rows)
    if (!lesson) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 404 })
    paths = imagePaths(parseLessonContent(lesson.content as string | null))
      .filter(p => isOwnLessonImage(p, lesson.tenant_id as string, lesson.teacher_id as string))
  } else if (isUuid(itemId)) {
    const [rows] = await run(asUser, sql => [sql`select content, tenant_id from public.unit_items where id = ${itemId}`])
    const item = maybeOne<{ content: unknown; tenant_id: string }>(rows)
    if (!item) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 404 })
    const body = (item.content as { body?: unknown } | null)?.body
    paths = imagePaths(parseLessonContent(typeof body === 'string' ? body : ''))
      .filter(p => LESSON_IMAGE.test(p) && p.startsWith(`${item.tenant_id}/`))
  } else {
    return NextResponse.json({ ...(await apiErr('missingId')) }, { status: 400 })
  }

  const urls = await signFileMap(Object.fromEntries(paths.map(p => [p, p])))
  return NextResponse.json({ urls })
}
