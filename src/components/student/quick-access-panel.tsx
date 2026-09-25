'use client'

import { useState, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import { cn } from '@/lib/utils'
import {
  BookOpen, ClipboardList, Layers, ChevronRight,
  PanelRightOpen, PanelRightClose, Loader2,
} from 'lucide-react'

interface CourseItem  { id: string; title: string }
interface LessonItem  { id: string; title: string }
interface ExamItem    { id: string; title: string; due_date: string | null }

interface QuickData {
  courses:  CourseItem[]
  lessons:  LessonItem[]
  exams:    ExamItem[]
}

export function StudentQuickAccessPanel() {
  const t = useTranslations('student.widgets.quick')
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

  // Fetching is triggered from the toggle handler below, not from an effect
  // reacting to `open` — calling setState (via fetchData) synchronously inside
  // an effect body causes cascading renders; doing it from the user gesture
  // that opens the panel avoids that entirely.

  const sections = data ? [
    {
      label: t('courses'),
      icon: Layers,
      color: 'text-violet-400',
      items: data.courses.map(c => ({ label: c.title, href: '/student/courses' })),
      emptyText: t('coursesEmpty'),
    },
    {
      label: t('lessons'),
      icon: BookOpen,
      color: 'text-blue-400',
      items: data.lessons.map(l => ({ label: l.title, href: `/student/lessons` })),
      emptyText: t('lessonsEmpty'),
    },
    {
      label: t('exams'),
      icon: ClipboardList,
      color: 'text-amber-400',
      items: data.exams.map(e => ({ label: e.title, href: '/student/exams' })),
      emptyText: t('examsEmpty'),
    },
  ] : []

  return (
    <>
      {/* Toggle button — fixed to right edge */}
      <button
        onClick={() => {
          setOpen(v => {
            const next = !v
            if (next && !data) fetchData()
            return next
          })
        }}
        className={cn(
          'fixed end-0 top-1/2 -translate-y-1/2 z-40',
          'bg-slate-800 hover:bg-slate-700 border border-slate-700 border-e-0',
          'text-slate-300 hover:text-white transition-all duration-200',
          'rounded-s-xl p-2.5 shadow-lg',
          open && 'end-72',
        )}
        title={open ? t('close') : t('open')}
      >
        {open
          ? <PanelRightClose className="w-4 h-4" />
          : <PanelRightOpen  className="w-4 h-4" />}
      </button>

      {/* Panel */}
      <div className={cn(
        'fixed end-0 top-16 bottom-0 w-72 z-30',
        'bg-slate-900 border-s border-slate-800',
        'flex flex-col overflow-hidden',
        'transition-transform duration-300',
        // The panel is pinned to the inline end, which is the LEFT edge under
        // dir=rtl, so hiding it there means translating left, not right.
        open ? 'translate-x-0' : 'translate-x-full rtl:-translate-x-full',
      )}>
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <h3 className="text-white font-semibold text-sm">{t('title')}</h3>
          {loading && <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />}
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {!data && !loading && (
            <p className="text-slate-500 text-xs text-center mt-8">{t('loading')}</p>
          )}

          {sections.map(({ label, icon: Icon, color, items, emptyText }) => (
            <div key={label}>
              <div className="flex items-center gap-2 mb-2">
                <Icon className={cn('w-4 h-4', color)} />
                <span className="text-slate-400 text-xs font-semibold uppercase tracking-wide">{label}</span>
              </div>
              {items.length === 0 ? (
                <p className="text-slate-600 text-xs ps-6">{emptyText}</p>
              ) : (
                <ul className="space-y-1">
                  {items.map((item, i) => (
                    <li key={i}>
                      <button
                        onClick={() => { router.push(item.href); setOpen(false) }}
                        className="w-full text-start flex items-center gap-2 px-3 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors text-sm"
                      >
                        <ChevronRight className="w-3 h-3 text-slate-600 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>

        <div className="p-3 border-t border-slate-800">
          <button
            onClick={fetchData}
            className="w-full text-xs text-slate-500 hover:text-slate-300 transition-colors py-1"
          >
            {t('refresh')}
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
