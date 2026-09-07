'use client'

import { useRouter } from 'next/navigation'
import { GraduationCap, Users, BookOpen, Layers, TrendingUp } from 'lucide-react'
import { Button } from '@/components/ui/button'

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
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-fg">My Courses</h2>
          <p className="text-fg-secondary mt-1">Continuing Education Center</p>
        </div>
        <div className="text-center py-20 bg-surface border border-border rounded-lg">
          <GraduationCap className="w-12 h-12 text-fg-muted mx-auto mb-3" />
          <p className="text-fg-secondary">You are not enrolled in any courses yet.</p>
          <p className="text-fg-muted text-sm mt-1">Ask your instructor for a course invitation link.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-fg">My Courses</h2>
        <p className="text-fg-secondary mt-1">{courses.length} enrolled · Continuing Education Center</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {courses.map(course => {
          const progress = progressMap[course.id]
          const pct = progress?.percent ?? 0

          return (
            <div
              key={course.id}
              className="bg-surface border border-border rounded-lg p-5 hover:border-border-strong transition-colors flex flex-col"
            >
              {/* Icon + structure badge */}
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-lg bg-accent-subtle flex items-center justify-center">
                  <GraduationCap className="w-5 h-5 text-accent" />
                </div>
                <span className="text-xs px-2 py-1 rounded-full bg-surface text-fg-secondary flex items-center gap-1">
                  {course.has_levels ? <Layers className="w-3 h-3" /> : <BookOpen className="w-3 h-3" />}
                  {course.has_levels ? 'Leveled' : 'Flat'}
                </span>
              </div>

              <h3 className="text-fg font-semibold mb-1">{course.title}</h3>
              {course.description && (
                <p className="text-fg-secondary text-sm mb-2 line-clamp-2">{course.description}</p>
              )}

              {course.language && (
                <p className="text-fg-muted text-xs mb-3 flex items-center gap-1">
                  <BookOpen className="w-3 h-3" /> {course.language}
                </p>
              )}

              {course.users?.full_name && (
                <p className="text-fg-muted text-xs mb-3 flex items-center gap-1">
                  <Users className="w-3 h-3" /> {course.users.full_name}
                </p>
              )}

              {/* Progress bar */}
              {progress && progress.total > 0 && (
                <div className="mb-4 mt-auto">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-fg-secondary flex items-center gap-1">
                      <TrendingUp className="w-3 h-3" /> Progress
                    </span>
                    <span className="text-xs font-medium text-fg-secondary">{pct}%</span>
                  </div>
                  <div className="w-full bg-surface rounded-full h-1.5">
                    <div
                      className="bg-accent h-1.5 rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-xs text-fg-muted mt-1">{progress.completed} / {progress.total} items completed</p>
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
