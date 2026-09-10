'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, ArrowRight, BookOpen, Check, CheckCircle2, ChevronDown,
  FileText, GraduationCap, ListChecks, PlayCircle, Sparkles, Video,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Markdown } from '@/components/shared/markdown'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

export interface PlayerItem {
  id: string
  type: string
  title: string
  body: string
}

export interface PlayerUnit {
  id: string
  title: string
  items: PlayerItem[]
}

export interface PlayerLevel {
  id: string
  title: string
  units: PlayerUnit[]
}

interface Props {
  course: {
    id: string
    title: string
    description: string | null
    language: string | null
    teacherName: string | null
  }
  levels: PlayerLevel[]
  completedIds: string[]
  /** Read from the session on the server; RLS re-checks it against current_tenant_id(). */
  studentId: string
  tenantId: string
}

const TYPE_ICON: Record<string, typeof FileText> = {
  text: FileText,
  grammar: BookOpen,
  idioms: Sparkles,
  rules: ListChecks,
  task: ListChecks,
  quiz: ListChecks,
  video: Video,
}

const TYPE_LABEL: Record<string, string> = {
  text: 'Explanation',
  grammar: 'Grammar',
  idioms: 'Idioms',
  rules: 'Rules',
  task: 'Task',
  quiz: 'Quiz',
  video: 'Video',
}

export function CoursePlayerClient({ course, levels, completedIds, studentId, tenantId }: Props) {
  const supabase = createClient()
  const [completed, setCompleted] = useState<Set<string>>(() => new Set(completedIds))
  const [saving, setSaving] = useState(false)
  const [openLevels, setOpenLevels] = useState<Record<string, boolean>>(
    () => Object.fromEntries(levels.map((l, i) => [l.id, i === 0]))
  )

  const flat = useMemo(
    () =>
      levels.flatMap(level =>
        level.units.flatMap(unit =>
          unit.items.map(item => ({ item, unitTitle: unit.title, levelTitle: level.title }))
        )
      ),
    [levels]
  )

  const [activeIndex, setActiveIndex] = useState(() => {
    const done = new Set(completedIds)
    const next = flat.findIndex(entry => !done.has(entry.item.id))
    return next === -1 ? 0 : next
  })

  const total = flat.length
  const doneCount = flat.filter(entry => completed.has(entry.item.id)).length
  const percent = total === 0 ? 0 : Math.round((doneCount / total) * 100)
  const current = flat[activeIndex]

  async function markComplete() {
    if (!current || completed.has(current.item.id)) return
    setSaving(true)
    const { error } = await supabase
      .from('student_progress')
      .upsert(
        { student_id: studentId, unit_item_id: current.item.id, tenant_id: tenantId },
        { onConflict: 'student_id,unit_item_id', ignoreDuplicates: true }
      )
    setSaving(false)

    if (error) {
      toast.error('Could not save your progress. Please try again.')
      return
    }

    setCompleted(prev => new Set(prev).add(current.item.id))
    if (activeIndex < total - 1) setActiveIndex(activeIndex + 1)
    else toast.success('Course complete. Well done.')
  }

  if (total === 0) {
    return (
      <div className="max-w-3xl mx-auto">
        <BackLink />
        <div className="mb-7">
          <h1 className="text-xl font-semibold text-gray-900">{course.title}</h1>
        </div>
        <EmptyState
          icon={GraduationCap}
          title="Nothing published yet"
          description="Your instructor has not published any content for this course. Check back soon."
        />
      </div>
    )
  }

  const Icon = TYPE_ICON[current.item.type] ?? FileText

  return (
    <div className="max-w-6xl mx-auto">
      <BackLink />

      {/* Course header + overall progress */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">{course.title}</h1>
        <p className="text-sm text-gray-500 mt-1">
          {course.teacherName && <>{course.teacherName} · </>}
          {doneCount} of {total} sections complete
        </p>
        <div className="mt-3 w-full bg-gray-200 rounded-full h-1.5">
          <div
            className="bg-blue-600 h-1.5 rounded-full transition-all"
            style={{ width: `${percent}%` }}
            role="progressbar"
            aria-label="Course progress"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6 items-start">
        {/* Outline */}
        <nav aria-label="Course outline" className="bg-white border border-gray-200 rounded-lg p-2 lg:sticky lg:top-4">
          {levels.map(level => {
            const isOpen = level.title === '' ? true : openLevels[level.id] !== false
            return (
              <div key={level.id} className="mb-1 last:mb-0">
                {level.title !== '' && (
                  <button
                    type="button"
                    onClick={() => setOpenLevels(p => ({ ...p, [level.id]: !isOpen }))}
                    aria-expanded={isOpen}
                    className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-md text-sm font-medium text-gray-800 hover:bg-gray-50 transition-colors"
                  >
                    <span className="truncate text-start">{level.title}</span>
                    <ChevronDown
                      className={cn('w-4 h-4 shrink-0 text-gray-400 transition-transform', !isOpen && '-rotate-90 rtl:rotate-90')}
                      aria-hidden="true"
                    />
                  </button>
                )}

                {isOpen && level.units.map(unit => (
                  <div key={unit.id} className="mt-1">
                    <p className="px-2.5 py-1 text-xs uppercase tracking-wide text-gray-400 truncate">
                      {unit.title}
                    </p>
                    <ul>
                      {unit.items.map(item => {
                        const index = flat.findIndex(entry => entry.item.id === item.id)
                        const isActive = index === activeIndex
                        const isDone = completed.has(item.id)
                        return (
                          <li key={item.id}>
                            <button
                              type="button"
                              onClick={() => setActiveIndex(index)}
                              aria-current={isActive ? 'true' : undefined}
                              className={cn(
                                'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm text-start transition-colors',
                                isActive ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                              )}
                            >
                              {isDone
                                ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-green-600" aria-hidden="true" />
                                : <PlayCircle className="w-3.5 h-3.5 shrink-0 text-gray-400" aria-hidden="true" />}
                              <span className="truncate">{item.title}</span>
                              {isDone && <span className="sr-only">(completed)</span>}
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )
          })}
        </nav>

        {/* Reader */}
        <article className="bg-white border border-gray-200 rounded-lg p-6 min-w-0">
          <div className="flex items-start gap-3 pb-4 mb-5 border-b border-gray-200">
            <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
              <Icon className="w-4 h-4 text-blue-600" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs uppercase tracking-wide text-gray-500">
                {TYPE_LABEL[current.item.type] ?? current.item.type}
                {current.unitTitle && <> · {current.unitTitle}</>}
              </p>
              <h2 className="text-base font-semibold text-gray-900 leading-snug mt-0.5">{current.item.title}</h2>
            </div>
            {completed.has(current.item.id) && (
              <span className="flex items-center gap-1.5 text-xs text-green-600 shrink-0">
                <Check className="w-3.5 h-3.5" aria-hidden="true" />
                Done
              </span>
            )}
          </div>

          {current.item.body.trim()
            ? <Markdown content={current.item.body} />
            : <p className="text-sm text-gray-500">This section has no written content yet.</p>}

          {/* Section navigation */}
          <div className="flex flex-wrap items-center gap-3 mt-8 pt-5 border-t border-gray-200">
            <Button
              variant="secondary"
              size="sm"
              disabled={activeIndex === 0}
              onClick={() => setActiveIndex(i => Math.max(0, i - 1))}
            >
              <ArrowLeft className="w-4 h-4 rtl:hidden" aria-hidden="true" />
              <ArrowRight className="w-4 h-4 hidden rtl:inline" aria-hidden="true" />
              Previous
            </Button>

            {!completed.has(current.item.id) ? (
              <Button size="sm" loading={saving} onClick={markComplete}>
                Mark complete
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={activeIndex >= total - 1}
                onClick={() => setActiveIndex(i => Math.min(total - 1, i + 1))}
              >
                Next
                <ArrowRight className="w-4 h-4 rtl:hidden" aria-hidden="true" />
                <ArrowLeft className="w-4 h-4 hidden rtl:inline" aria-hidden="true" />
              </Button>
            )}

            <span className="text-xs text-gray-500 ms-auto">
              Section {activeIndex + 1} of {total}
            </span>
          </div>
        </article>
      </div>
    </div>
  )
}

function BackLink() {
  return (
    <Link
      href="/student/courses"
      className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors mb-4"
    >
      <ArrowLeft className="w-3.5 h-3.5 rtl:hidden" aria-hidden="true" />
      <ArrowRight className="w-3.5 h-3.5 hidden rtl:inline" aria-hidden="true" />
      All courses
    </Link>
  )
}
