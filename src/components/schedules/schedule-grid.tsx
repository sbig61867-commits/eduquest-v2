import { Clock, MapPin, User } from 'lucide-react'
import { DAY_LABELS, formatTime, slotsForDay, type ScheduleSlot } from './types'

// Read-only 7-day timetable. Shared by the student view, the teacher view
// and the staff editor's preview. Server-rendered (no client state), and
// scrolls horizontally on narrow screens rather than squashing the columns.
export function ScheduleGrid({
  slots,
  showGroup = false,
  emptyText = 'لا توجد مواعيد في هذا الجدول بعد.',
}: {
  slots: ScheduleSlot[]
  showGroup?: boolean
  emptyText?: string
}) {
  if (slots.length === 0) {
    return (
      <div className="text-center py-16 bg-slate-900 border border-slate-800 rounded-xl">
        <Clock className="w-10 h-10 text-slate-600 mx-auto mb-3" />
        <p className="text-slate-400">{emptyText}</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3 min-w-full lg:min-w-[900px]">
        {DAY_LABELS.map((label, day) => {
          const daySlots = slotsForDay(slots, day)
          return (
            <div key={day} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-3 py-2 border-b border-slate-800 bg-slate-800/50">
                <p className="text-white text-sm font-semibold">{label}</p>
                <p className="text-slate-500 text-[11px]">
                  {daySlots.length === 0 ? 'لا مواعيد' : `${daySlots.length} موعد`}
                </p>
              </div>

              <div className="p-2 space-y-2 min-h-[72px]">
                {daySlots.length === 0 ? (
                  <p className="text-slate-600 text-xs text-center py-4">—</p>
                ) : (
                  daySlots.map(slot => (
                    <div key={slot.id} className="rounded-lg bg-slate-800/70 border border-slate-700/60 p-2.5">
                      <p className="text-white text-sm font-medium leading-tight">{slot.title}</p>
                      <p className="text-blue-300 text-xs mt-1 flex items-center gap-1">
                        <Clock className="w-3 h-3 shrink-0" />
                        {formatTime(slot.start_time)} – {formatTime(slot.end_time)}
                      </p>
                      {showGroup && slot.group_name && (
                        <p className="text-slate-400 text-[11px] mt-1">{slot.group_name}</p>
                      )}
                      {slot.teacher_name && (
                        <p className="text-slate-400 text-[11px] mt-1 flex items-center gap-1">
                          <User className="w-3 h-3 shrink-0" />{slot.teacher_name}
                        </p>
                      )}
                      {slot.location && (
                        <p className="text-slate-400 text-[11px] mt-1 flex items-center gap-1">
                          <MapPin className="w-3 h-3 shrink-0" />{slot.location}
                        </p>
                      )}
                      {slot.note && (
                        <p className="text-slate-500 text-[11px] mt-1 leading-snug">{slot.note}</p>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
