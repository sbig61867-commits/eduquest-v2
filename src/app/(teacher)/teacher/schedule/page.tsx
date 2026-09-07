export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ScheduleGrid } from '@/components/schedules/schedule-grid'
import { loadTeacherSchedules } from '@/lib/schedules-data'
import { CalendarDays, Users, User } from 'lucide-react'

// Read-only. RLS narrows this to the teacher own private timetable plus
// the timetables of groups they teach; the admin or centre manager is the
// one who edits them.
export default async function TeacherSchedulePage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user?.tenant_id) redirect('/login')

  const schedules = await loadTeacherSchedules(supabase, user.tenant_id)

  return (
    <div className="space-y-6" dir="rtl">
      <div>
        <h2 className="text-2xl font-bold text-fg">جداول المواعيد</h2>
        <p className="text-fg-secondary mt-1">جداول مجموعاتك وجدولك الخاص — يرتّبها مدير المؤسسة بالتنسيق معك.</p>
      </div>

      {schedules.length === 0 ? (
        <div className="text-center py-20 bg-surface border border-border rounded-lg">
          <CalendarDays className="w-12 h-12 text-fg-muted mx-auto mb-3" />
          <p className="text-fg-secondary">لا توجد جداول مرتبطة بك بعد.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {schedules.map(s => (
            <section key={s.id} className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                {s.kind === 'group'
                  ? <Users className="w-4 h-4 text-accent" />
                  : <User className="w-4 h-4 text-accent" />}
                <h3 className="text-fg font-semibold">{s.target_name ?? '—'}</h3>
                <span className="text-fg-muted text-xs">{s.title}</span>
                {s.kind === 'group' && (
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${
                    s.is_published ? 'text-accent bg-accent-subtle' : 'text-fg-secondary bg-surface'
                  }`}>
                    {s.is_published ? 'منشور للطلاب' : 'مسودة'}
                  </span>
                )}
                {s.kind === 'teacher' && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full text-accent bg-accent-subtle">
                    خاص بك — لا يراه الطلاب
                  </span>
                )}
              </div>
              <ScheduleGrid slots={s.slots} />
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
