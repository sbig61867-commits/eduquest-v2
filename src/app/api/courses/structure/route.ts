import { NextResponse } from 'next/server'
import { apiErr } from '@/lib/api-error'
import { currentUser } from '@/lib/auth/current'
import { run, maybeOne } from '@/lib/db/sql'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ITEM_TYPES = new Set(['text', 'grammar', 'idioms', 'rules', 'task', 'quiz', 'video'])
const MAX_TITLE = 300
const MAX_CONTENT_BYTES = 512_000

// The course builder's writes (/teacher/courses/[id]): add a level, a unit or
// an item, edit an item, delete any of them. Every statement runs AS THE
// TEACHER, so the same RLS that decided the browser's direct writes before
// step 9 decides here (own institution, own course). The institution comes
// from the session, never from the body, and each insert also checks in the
// same statement that the course is the caller's own.

type Kind = 'level' | 'unit' | 'item'
const isKind = (v: unknown): v is Kind => v === 'level' || v === 'unit' || v === 'item'
const title = (v: unknown) => (typeof v === 'string' && v.trim() && v.length <= MAX_TITLE ? v.trim() : null)
const content = (v: unknown) =>
  v && typeof v === 'object' && !Array.isArray(v) && JSON.stringify(v).length <= MAX_CONTENT_BYTES ? v as Record<string, unknown> : null

async function caller() {
  const user = await currentUser()
  return user?.tenant_id ? { id: user.id, tenantId: user.tenant_id } : null
}
const bad = async () => NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
const denied = async () => NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })

export async function POST(request: Request) {
  const me = await caller()
  if (!me) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const b = await request.json().catch(() => null) as Record<string, unknown> | null
  const kind = b?.kind
  const courseId = String(b?.course_id ?? '')
  const name = title(b?.title)
  const order = Number.isInteger(b?.order_index) ? Number(b!.order_index) : 0
  if (!isKind(kind) || !UUID.test(courseId) || !name) return bad()

  const own = { as: 'user' as const, userId: me.id }
  try {
    if (kind === 'level') {
      const [rows] = await run(own, sql => [
        sql`insert into public.course_levels (course_id, tenant_id, title, order_index)
            select c.id, ${me.tenantId}, ${name}, ${order} from public.courses c where c.id = ${courseId} and c.teacher_id = ${me.id}
            returning id, title, order_index, is_published`,
      ])
      const level = maybeOne(rows)
      return level ? NextResponse.json({ ...level, course_units: [] }) : denied()
    }
    if (kind === 'unit') {
      const levelId = b?.level_id == null ? null : String(b.level_id)
      if (levelId !== null && !UUID.test(levelId)) return bad()
      const [rows] = await run(own, sql => [
        sql`insert into public.course_units (course_id, tenant_id, level_id, title, order_index)
            select c.id, ${me.tenantId}, ${levelId}, ${name}, ${order} from public.courses c where c.id = ${courseId} and c.teacher_id = ${me.id}
            returning id, title, order_index, is_published, level_id`,
      ])
      const unit = maybeOne(rows)
      return unit ? NextResponse.json({ ...unit, unit_items: [] }) : denied()
    }
    const unitId = String(b?.unit_id ?? '')
    const type = String(b?.type ?? '')
    const body = content(b?.content)
    if (!UUID.test(unitId) || !ITEM_TYPES.has(type) || !body) return bad()
    const [rows] = await run(own, sql => [
      sql`insert into public.unit_items (unit_id, course_id, tenant_id, title, type, content, order_index)
          select u.id, u.course_id, ${me.tenantId}, ${name}, ${type}, ${sql.json(body as Parameters<typeof sql.json>[0])}, 0
            from public.course_units u join public.courses c on c.id = u.course_id
           where u.id = ${unitId} and u.course_id = ${courseId} and c.teacher_id = ${me.id}
          returning id, title, type, order_index, is_published, content`,
    ])
    const item = maybeOne(rows)
    return item ? NextResponse.json(item) : denied()
  } catch (e) {
    console.error('[courses/structure POST]', e instanceof Error ? e.message : e)
    return denied()
  }
}

/** PATCH { id, title, type, content } — edit one item of the caller's own course. */
export async function PATCH(request: Request) {
  const me = await caller()
  if (!me) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const b = await request.json().catch(() => null) as Record<string, unknown> | null
  const id = String(b?.id ?? '')
  const name = title(b?.title)
  const type = String(b?.type ?? '')
  const body = content(b?.content)
  if (!UUID.test(id) || !name || !ITEM_TYPES.has(type) || !body) return bad()
  try {
    const [rows] = await run({ as: 'user', userId: me.id }, sql => [
      sql`update public.unit_items i set title = ${name}, type = ${type}, content = ${sql.json(body as Parameters<typeof sql.json>[0])}
           from public.courses c
          where i.id = ${id} and c.id = i.course_id and c.teacher_id = ${me.id}
          returning i.id, i.title, i.type, i.order_index, i.is_published, i.content`,
    ])
    const item = maybeOne(rows)
    return item ? NextResponse.json(item) : NextResponse.json({ ...(await apiErr('notFound')) }, { status: 404 })
  } catch (e) {
    console.error('[courses/structure PATCH]', e instanceof Error ? e.message : e)
    return denied()
  }
}

/** DELETE ?kind=level|unit|item&id=… — remove one part of the caller's own course. */
export async function DELETE(request: Request) {
  const me = await caller()
  if (!me) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const q = new URL(request.url).searchParams
  const kind = q.get('kind')
  const id = q.get('id') ?? ''
  if (!isKind(kind) || !UUID.test(id)) return bad()
  try {
    const [rows] = await run({ as: 'user', userId: me.id }, sql => [
      kind === 'level'
        ? sql`delete from public.course_levels x using public.courses c where x.id = ${id} and c.id = x.course_id and c.teacher_id = ${me.id} returning x.id`
        : kind === 'unit'
          ? sql`delete from public.course_units x using public.courses c where x.id = ${id} and c.id = x.course_id and c.teacher_id = ${me.id} returning x.id`
          : sql`delete from public.unit_items x using public.courses c where x.id = ${id} and c.id = x.course_id and c.teacher_id = ${me.id} returning x.id`,
    ])
    return rows.length ? NextResponse.json({ ok: true }) : NextResponse.json({ ...(await apiErr('notFound')) }, { status: 404 })
  } catch (e) {
    console.error('[courses/structure DELETE]', e instanceof Error ? e.message : e)
    return denied()
  }
}
