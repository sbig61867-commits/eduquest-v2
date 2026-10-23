import { run, maybeOne, type Sql } from '@/lib/db/sql'
import { can } from '@/lib/permissions'
import type { ScheduleRow, ScheduleSlot, TargetOption } from '@/components/schedules/types'

// Loaders for the weekly-timetable feature, on the SQL layer: each is ONE unit
// read as the caller, so RLS decides exactly as before. Slots come with their
// schedule as a JSON array; group and teacher names are resolved in TS from
// the institution's lookups read in the same unit.

const LIMIT = 1000

interface RawSlot {
  id: string
  day_of_week: number
  start_time: string
  end_time: string
  title: string
  teacher_id: string | null
  location: string | null
  note: string | null
}

interface RawSchedule {
  id: string
  kind: 'group' | 'teacher'
  group_id: string | null
  teacher_id: string | null
  title: string
  is_published: boolean
  schedule_slots: RawSlot[] | null
}

/** The institution's timetables, each with its slots (in the order the editor shows them). */
const schedulesSql = (sql: Sql, tenantId: string) => sql`
  select s.id, s.kind, s.group_id, s.teacher_id, s.title, s.is_published,
         coalesce((select json_agg(json_build_object('id', sl.id, 'day_of_week', sl.day_of_week, 'start_time', sl.start_time,
                     'end_time', sl.end_time, 'title', sl.title, 'teacher_id', sl.teacher_id, 'location', sl.location, 'note', sl.note))
                     from public.schedule_slots sl where sl.schedule_id = s.id), '[]') as schedule_slots
    from public.schedules s where s.tenant_id = ${tenantId}
   order by s.created_at desc limit ${LIMIT}`

function toRows(
  raw: RawSchedule[],
  groupNames: Map<string, string>,
  teacherNames: Map<string, string>,
): ScheduleRow[] {
  return raw.map(s => ({
    id: s.id,
    kind: s.kind,
    group_id: s.group_id,
    teacher_id: s.teacher_id,
    target_name: s.kind === 'group'
      ? groupNames.get(s.group_id ?? '') ?? null
      : teacherNames.get(s.teacher_id ?? '') ?? null,
    title: s.title,
    is_published: s.is_published,
    slots: (s.schedule_slots ?? []).map<ScheduleSlot>(sl => ({
      id: sl.id,
      day_of_week: sl.day_of_week,
      start_time: sl.start_time,
      end_time: sl.end_time,
      title: sl.title,
      teacher_id: sl.teacher_id,
      teacher_name: sl.teacher_id ? teacherNames.get(sl.teacher_id) ?? null : null,
      location: sl.location,
      note: sl.note,
    })),
  }))
}

type Named = { id: string; name?: string; full_name?: string | null }

/**
 * Staff timetable editor. Reports whether the caller actually holds
 * `manage_schedules` — the page shows a permission notice when they don't.
 */
export async function loadSchedulesPage(
  userId: string,
  tenantId: string,
): Promise<{ allowed: boolean; schedules: ScheduleRow[]; targets: TargetOption[] }> {
  const [me, raw, groups, teachers] = await run({ as: 'user', userId }, sql => [
    sql`select role, permissions from public.users where id = ${userId}`,
    schedulesSql(sql, tenantId),
    sql`select id, name from public.groups where tenant_id = ${tenantId} order by name limit ${LIMIT}`,
    sql`select id, full_name from public.users where tenant_id = ${tenantId} and role = 'teacher' and is_active
         order by full_name limit ${LIMIT}`,
  ])
  const profile = maybeOne<{ role: string; permissions: Record<string, unknown> | null }>(me)
  if (!can(profile?.role, profile?.permissions, 'manage_schedules')) {
    return { allowed: false, schedules: [], targets: [] }
  }

  const g = groups as unknown as Named[]
  const t = teachers as unknown as Named[]
  const groupNames = new Map(g.map(x => [x.id, x.name ?? '']))
  const teacherNames = new Map(t.map(x => [x.id, x.full_name ?? '·']))
  const targets: TargetOption[] = [
    ...g.map(x => ({ id: x.id, name: x.name ?? '', kind: 'group' as const })),
    ...t.map(x => ({ id: x.id, name: x.full_name ?? '·', kind: 'teacher' as const })),
  ]
  return { allowed: true, schedules: toRows(raw as unknown as RawSchedule[], groupNames, teacherNames), targets }
}

/**
 * Teacher view: RLS already narrows this to their own private timetable
 * plus the timetables of groups they teach, so no extra filter is needed
 * (the tenant filter stays as defence in depth).
 */
export async function loadTeacherSchedules(userId: string, tenantId: string): Promise<ScheduleRow[]> {
  const [raw, groups, teachers] = await run({ as: 'user', userId }, sql => [
    schedulesSql(sql, tenantId),
    sql`select id, name from public.groups where tenant_id = ${tenantId} limit ${LIMIT}`,
    sql`select id, full_name from public.users where tenant_id = ${tenantId} and role = 'teacher' limit ${LIMIT}`,
  ])
  const groupNames = new Map((groups as unknown as Named[]).map(x => [x.id, x.name ?? '']))
  const teacherNames = new Map((teachers as unknown as Named[]).map(x => [x.id, x.full_name ?? '·']))
  return toRows(raw as unknown as RawSchedule[], groupNames, teacherNames)
}

interface RawStudentSlot {
  slot_id: string
  group_id: string
  group_name: string | null
  day_of_week: number
  start_time: string
  end_time: string
  title: string
  teacher_name: string | null
  location: string | null
  note: string | null
}

/**
 * Student view. Students get no direct row read on schedules; this function
 * applies publication state and group enrolment server-side.
 */
export async function loadStudentSchedule(userId: string): Promise<ScheduleSlot[]> {
  const [rows] = await run({ as: 'user', userId }, sql => [sql`select * from public.get_student_schedule()`])
  return (rows as unknown as RawStudentSlot[]).map<ScheduleSlot>(r => ({
    id: r.slot_id,
    day_of_week: r.day_of_week,
    start_time: r.start_time,
    end_time: r.end_time,
    title: r.title,
    teacher_id: null,
    teacher_name: r.teacher_name,
    location: r.location,
    note: r.note,
    group_name: r.group_name,
  }))
}
