import type { SupabaseClient } from '@supabase/supabase-js'
import { can } from '@/lib/permissions'
import type { ScheduleRow, ScheduleSlot, TargetOption } from '@/components/schedules/types'

// Loaders for the weekly-timetable feature.
//
// Slot teacher names are resolved in TS from a tenant teacher lookup rather
// than a nested PostgREST embed: `schedules` has two foreign keys into
// `users` (teacher_id and created_by), so nested embeds there need explicit
// constraint hints and are easy to get subtly wrong.

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

const SCHEDULE_SELECT = `
  id, kind, group_id, teacher_id, title, is_published,
  schedule_slots(id, day_of_week, start_time, end_time, title, teacher_id, location, note)
`

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

/**
 * Staff timetable editor. Reports whether the caller actually holds
 * `manage_schedules` — the page shows a permission notice when they don't.
 */
export async function loadSchedulesPage(
  supabase: SupabaseClient,
  userId: string,
  tenantId: string,
): Promise<{ allowed: boolean; schedules: ScheduleRow[]; targets: TargetOption[] }> {
  const { data: profile } = await supabase
    .from('users').select('role, permissions').eq('id', userId).single()

  if (!can(profile?.role, profile?.permissions, 'manage_schedules')) {
    return { allowed: false, schedules: [], targets: [] }
  }

  const [{ data: raw }, { data: groups }, { data: teachers }] = await Promise.all([
    supabase.from('schedules').select(SCHEDULE_SELECT)
      .eq('tenant_id', tenantId).order('created_at', { ascending: false }),
    supabase.from('groups').select('id, name').eq('tenant_id', tenantId).order('name'),
    supabase.from('users').select('id, full_name')
      .eq('tenant_id', tenantId).eq('role', 'teacher').eq('is_active', true).order('full_name'),
  ])

  const groupNames = new Map((groups ?? []).map(g => [g.id as string, g.name as string]))
  const teacherNames = new Map((teachers ?? []).map(t => [t.id as string, (t.full_name as string) ?? '·']))

  const targets: TargetOption[] = [
    ...(groups ?? []).map(g => ({ id: g.id as string, name: g.name as string, kind: 'group' as const })),
    ...(teachers ?? []).map(t => ({ id: t.id as string, name: (t.full_name as string) ?? '·', kind: 'teacher' as const })),
  ]

  return {
    allowed: true,
    schedules: toRows((raw ?? []) as unknown as RawSchedule[], groupNames, teacherNames),
    targets,
  }
}

/**
 * Teacher view: RLS already narrows this to their own private timetable
 * plus the timetables of groups they teach, so no extra filter is needed
 * (the tenant filter stays as defence in depth).
 */
export async function loadTeacherSchedules(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<ScheduleRow[]> {
  const [{ data: raw }, { data: groups }, { data: teachers }] = await Promise.all([
    supabase.from('schedules').select(SCHEDULE_SELECT)
      .eq('tenant_id', tenantId).order('created_at', { ascending: false }),
    supabase.from('groups').select('id, name').eq('tenant_id', tenantId),
    supabase.from('users').select('id, full_name').eq('tenant_id', tenantId).eq('role', 'teacher'),
  ])

  const groupNames = new Map((groups ?? []).map(g => [g.id as string, g.name as string]))
  const teacherNames = new Map((teachers ?? []).map(t => [t.id as string, (t.full_name as string) ?? '·']))

  return toRows((raw ?? []) as unknown as RawSchedule[], groupNames, teacherNames)
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
 * Student view. Students get no direct row read on schedules; this RPC
 * applies publication state and group enrolment server-side.
 */
export async function loadStudentSchedule(supabase: SupabaseClient): Promise<ScheduleSlot[]> {
  const { data } = await supabase.rpc('get_student_schedule')
  return ((data ?? []) as unknown as RawStudentSlot[]).map<ScheduleSlot>(r => ({
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
