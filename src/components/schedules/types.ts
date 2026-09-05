// Shared shapes for the weekly-timetable feature (Phase 3).
// A timetable is a `schedule` (one per group, or one private one per
// teacher) holding `schedule_slots` laid out over a 7-day week.

export interface ScheduleSlot {
  id: string
  day_of_week: number          // 0 = Sunday … 6 = Saturday
  start_time: string           // 'HH:MM:SS' (wall-clock, no timezone)
  end_time: string
  title: string
  teacher_id: string | null
  teacher_name: string | null
  location: string | null
  note: string | null
  /** Only set in the student view, where slots span several groups. */
  group_name?: string | null
}

export interface ScheduleRow {
  id: string
  kind: 'group' | 'teacher'
  group_id: string | null
  teacher_id: string | null
  /** Group name, or teacher name for a private timetable. */
  target_name: string | null
  title: string
  is_published: boolean
  slots: ScheduleSlot[]
}

/** A group or teacher that a timetable can be built for. */
export interface TargetOption {
  id: string
  name: string
  kind: 'group' | 'teacher'
}

export const DAY_LABELS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']

/** '09:30:00' → '09:30' */
export function formatTime(t: string): string {
  return typeof t === 'string' ? t.slice(0, 5) : ''
}

export function slotsForDay(slots: ScheduleSlot[], day: number): ScheduleSlot[] {
  return slots
    .filter(s => s.day_of_week === day)
    .sort((a, b) => a.start_time.localeCompare(b.start_time))
}
