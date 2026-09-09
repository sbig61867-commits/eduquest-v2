'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import { cn } from '@/lib/utils'
import {
  BookOpen, ClipboardList, Layers, ChevronRight,
  PanelRightOpen, PanelRightClose, Loader2,
} from 'lucide-react'
import { StaggerGrid, StaggerItem } from '@/components/shared/motion'

interface CourseItem  { id: string; title: string }
interface LessonItem  { id: string; title: string }
interface ExamItem    { id: string; title: string; due_date: string | null }

interface QuickData {
  courses:  CourseItem[]
  lessons:  LessonItem[]
  exams:    ExamItem[]
}

export function StudentQuickAccessPanel() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<QuickData | null>(null)
  const [loading, setLoading] = useState(false)
  const { user } = useAuthStore()
  const router = useRouter()
  const supabase = createClient()

  const fetchData = useCallback(async () => {
    if (!user?.id) return
    setLoading(true)
    try {
      // Groups the student belongs to (needed for lessons)
      const { data: groupRows } = await supabase
        .from('group_students')
        .select('group_id')
        .eq('student_id', user.id)
      const groupIds = (groupRows ?? []).map(r => r.group_id)

      // Fetch course IDs first, then titles
      const { data: enrollments } = await supabase
        .from('course_enrollments')
        .select('course_id')
        .eq('student_id', user.id)
        .limit(6)
      const courseIds = (enrollments ?? []).map((e: { course_id: string }) => e.course_id)

      const [coursesRes, lessonsRes, examsRes] = await Promise.all([
        courseIds.length > 0
          ? supabase.from('courses').select('id, title').in('id', courseIds).eq('is_published', true)
          : Promise.resolve({ data: [] }),
        groupIds.length > 0
          ? supabase
              .from('lessons')
              .select('id, title')
              .eq('is_published', true)
              .in('group_id', groupIds)
              .order('created_at', { ascending: false })
              .limit(5)
          : Promise.resolve({ data: [] }),
        supabase.rpc('get_student_exams'),
      ])

      setData({
        courses: (coursesRes.data ?? []) as CourseItem[],
        lessons: (lessonsRes.data ?? []) as LessonItem[],
        exams:   ((examsRes.data ?? []) as ExamItem[]).slice(0, 5),
      })
    } finally {
      setLoading(false)
    }
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || data) return
    // Defer out of the render/effect-commit phase so the loading setState in
    // fetchData() does not cascade a synchronous re-render.
    const id = setTimeout(fetchData, 0)
    return () => clearTimeout(id)
  }, [open, data, fetchData])

  const sections = data ? [
    {
      label: 'My Courses',
      icon: Layers,
      color: 'text-accent',
      items: data.courses.map(c => ({ label: c.title, href: '/student/courses' })),
      emptyText: 'No courses yet',
    },
    {
      label: 'Recent Lessons',
      icon: BookOpen,
      color: 'text-accent',
      items: data.lessons.map(l => ({ label: l.title, href: `/student/lessons` })),
      emptyText: 'No lessons yet',
    },
    {
      label: 'Exams',
      icon: ClipboardList,
      color: 'text-accent',
      items: data.exams.map(e => ({ label: e.title, href: '/student/exams' })),
      emptyText: 'No exams',
    },
  ] : []

  return (
    <>
      {/* Toggle button — fixed to right edge */}
      <button
        onClick={() => setOpen(v => !v)}
        className={cn(
          'fixed right-0 top-1/2 -translate-y-1/2 z-40',
          'bg-surface hover:bg-canvas border border-border-strong border-r-0',
          'text-fg-secondary hover:text-fg transition-all duration-200',
          'rounded-l-xl p-2.5 shadow-lg',
          open && 'right-72',
        )}
        title={open ? 'Close quick access' : 'Quick access'}
      >
        {open
          ? <PanelRightClose className="w-4 h-4" />
          : <PanelRightOpen  className="w-4 h-4" />}
      </button>

      {/* Panel */}
      <div className={cn(
        'fixed right-0 top-16 bottom-0 w-72 z-30',
        'bg-surface border-l border-border',
        'flex flex-col overflow-hidden',
        'transition-transform duration-300',
        open ? 'translate-x-0' : 'translate-x-full',
      )}>
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h3 className="text-fg font-semibold text-sm">Quick Access</h3>
          {loading && <Loader2 className="w-4 h-4 text-fg-secondary animate-spin" />}
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {!data && !loading && (
            <p className="text-fg-muted text-xs text-center mt-8">Opening panel…</p>
          )}

          {sections.map(({ label, icon: Icon, color, items, emptyText }) => (
            <div key={label}>
              <div className="flex items-center gap-2 mb-2">
                <Icon className={cn('w-4 h-4', color)} />
                <span className="text-fg-secondary text-xs font-semibold uppercase tracking-wide">{label}</span>
              </div>
              {items.length === 0 ? (
                <p className="text-fg-muted text-xs pl-6">{emptyText}</p>
              ) : (
                <StaggerGrid className="space-y-1">
                  {items.map((item, i) => (
                    <StaggerItem key={i}>
                      <button
                        onClick={() => { router.push(item.href); setOpen(false) }}
                        className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg text-fg-secondary hover:text-fg hover:bg-surface transition-colors text-sm"
                      >
                        <ChevronRight className="w-3 h-3 text-fg-muted shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </button>
                    </StaggerItem>
                  ))}
                </StaggerGrid>
              )}
            </div>
          ))}
        </div>

        <div className="p-3 border-t border-border">
          <button
            onClick={fetchData}
            className="w-full text-xs text-fg-muted hover:text-fg-secondary transition-colors py-1"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Backdrop on mobile */}
      {open && (
        <div
          className="fixed inset-0 z-20 bg-black/40 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}
    </>
  )
}
