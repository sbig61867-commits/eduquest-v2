'use client'

import { useRouter } from 'next/navigation'
import { GraduationCap, Users, BookOpen, Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'

interface Course {
  id: string
  title: string
  description: string | null
  language: string | null
  has_levels: boolean
  users: { full_name: string } | null
}

interface Progress {
  total: number
  completed: number
  percent: number
}

interface Props {
  courses: Course[]
  progressMap: Record<string, Progress | null>
}

export function StudentCoursesClient({ courses, progressMap }: Props) {
  const router = useRouter()

  if (courses.length === 0) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="mb-7">
          <h1 className="text-xl font-semibold text-fg">Courses</h1>
          <p className="text-[13px] text-fg-muted mt-1.5">Continuing Education Center</p>
        </div>
        <EmptyState
          icon={GraduationCap}
          title="No courses yet"
          description="Ask your instructor for a course invitation link."
        />
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-7">
        <h1 className="text-xl font-semibold text-fg">Courses</h1>
        <p className="text-[13px] text-fg-muted mt-1.5">
          {courses.length} enrolled · Continuing Education Center
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {courses.map(course => {
          const progress = progressMap[course.id]
          const pct = progress?.percent ?? 0

          return (
            <div
              key={course.id}
              className="bg-surface border border-border rounded-lg p-5 hover:border-border-strong transition-colors flex flex-col gap-3"
            >
              {/* Title row */}
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-accent-subtle flex items-center justify-center shrink-0">
                  <GraduationCap className="w-[17px] h-[17px] text-accent" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold text-fg leading-snug">{course.title}</p>
                  {course.description && (
                    <p className="text-[12px] text-fg-muted mt-1 line-clamp-2 leading-relaxed">
                      {course.description}
                    </p>
                  )}
                </div>
              </div>

              {/* Metadata row */}
              <div className="flex items-center gap-3 flex-wrap">
                <span className="flex items-center gap-1.5 text-[12px] text-fg-muted">
                  {course.has_levels ? <Layers className="w-3.5 h-3.5" aria-hidden="true" /> : <BookOpen className="w-3.5 h-3.5" aria-hidden="true" />}
                  {course.has_levels ? 'Leveled' : 'Flat'}
                </span>
                {course.language && (
                  <span className="text-[12px] text-fg-muted">{course.language}</span>
                )}
                {course.users?.full_name && (
                  <span className="flex items-center gap-1.5 text-[12px] text-fg-muted">
                    <Users className="w-3.5 h-3.5" aria-hidden="true" />
                    {course.users.full_name}
                  </span>
                )}
              </div>

              {/* Progress bar */}
              {progress && progress.total > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] text-fg-muted">
                      {progress.completed} / {progress.total} items
                    </span>
                    <span className="text-[11px] font-medium text-fg-secondary">{pct}%</span>
                  </div>
                  <div className="w-full bg-border rounded-full h-1">
                    <div
                      className="bg-accent h-1 rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                      role="progressbar"
                      aria-valuenow={pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    />
                  </div>
                </div>
              )}

              <Button
                className="w-full mt-auto"
                onClick={() => router.push(`/student/courses/${course.id}`)}
              >
                {pct > 0 ? 'Continue' : 'Start'} Course
              </Button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
