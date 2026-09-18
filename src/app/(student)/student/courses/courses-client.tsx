'use client'

import { useRouter } from 'next/navigation'
import { GraduationCap, Users, BookOpen, Layers, TrendingUp, History, Info } from 'lucide-react'
import { formatDate } from '@/lib/utils'
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

export interface CourseGroup {
  id: string
  name: string
  image_url: string | null
  instructions: string | null
}

export interface PastCourse {
  id: string
  from_course_id: string | null
  from_course_title: string | null
  from_group_name: string
  to_course_title: string | null
  frozen_completed: number | null
  frozen_total: number | null
  created_at: string
}

interface Props {
  courses: Course[]
  progressMap: Record<string, Progress | null>
  groupsByCourse?: Record<string, CourseGroup[]>
  pastCourses?: PastCourse[]
}

export function StudentCoursesClient({ courses, progressMap, groupsByCourse = {}, pastCourses = [] }: Props) {
  const router = useRouter()

  if (courses.length === 0 && pastCourses.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-white">My Courses</h2>
          <p className="text-slate-400 mt-1">Continuing Education Center</p>
        </div>
        <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl">
          <GraduationCap className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">You are not enrolled in any courses yet.</p>
          <p className="text-slate-500 text-sm mt-1">Ask your instructor for a course invitation link.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">My Courses</h2>
        <p className="text-slate-400 mt-1">{courses.length} enrolled · Continuing Education Center</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {courses.map(course => {
          const progress = progressMap[course.id]
          const pct = progress?.percent ?? 0

          return (
            <div
              key={course.id}
              className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition-colors flex flex-col"
            >
              {/* Icon (group picture when the student's group has one) + structure badge */}
              <div className="flex items-start justify-between mb-3">
                {groupsByCourse[course.id]?.find(g => g.image_url)?.image_url
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={groupsByCourse[course.id]!.find(g => g.image_url)!.image_url!} alt="" className="w-14 h-14 rounded-xl object-cover" />
                  : (
                    <div className="w-10 h-10 rounded-xl bg-violet-600/20 flex items-center justify-center">
                      <GraduationCap className="w-5 h-5 text-violet-400" />
                    </div>
                  )}
                <span className="text-xs px-2 py-1 rounded-full bg-slate-800 text-slate-400 flex items-center gap-1">
                  {course.has_levels ? <Layers className="w-3 h-3" /> : <BookOpen className="w-3 h-3" />}
                  {course.has_levels ? 'Leveled' : 'Flat'}
                </span>
              </div>

              <h3 className="text-white font-semibold mb-1">{course.title}</h3>
              {(groupsByCourse[course.id] ?? []).map(g => (
                <div key={g.id} className="mb-2">
                  <p className="text-violet-300 text-sm flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {g.name}</p>
                  {g.instructions && (
                    <p className="text-slate-400 text-xs mt-1 flex items-start gap-1 whitespace-pre-line">
                      <Info className="w-3 h-3 mt-0.5 shrink-0" /> {g.instructions}
                    </p>
                  )}
                </div>
              ))}
              {course.description && (
                <p className="text-slate-400 text-sm mb-2 line-clamp-2">{course.description}</p>
              )}

              {course.language && (
                <p className="text-slate-500 text-xs mb-3 flex items-center gap-1">
                  <BookOpen className="w-3 h-3" /> {course.language}
                </p>
              )}

              {course.users?.full_name && (
                <p className="text-slate-500 text-xs mb-3 flex items-center gap-1">
                  <Users className="w-3 h-3" /> {course.users.full_name}
                </p>
              )}

              {/* Progress bar */}
              {progress && progress.total > 0 && (
                <div className="mb-4 mt-auto">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-slate-400 flex items-center gap-1">
                      <TrendingUp className="w-3 h-3" /> Progress
                    </span>
                    <span className="text-xs font-medium text-slate-300">{pct}%</span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-1.5">
                    <div
                      className="bg-violet-500 h-1.5 rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-xs text-slate-500 mt-1">{progress.completed} / {progress.total} items completed</p>
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

      {pastCourses.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-white font-semibold flex items-center gap-2">
            <History className="w-4 h-4 text-slate-400" /> Previous courses
          </h3>
          <p className="text-slate-500 text-xs">
            Progress is frozen as it was when you moved — for reference only; nothing new is counted here.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {pastCourses.map(t => {
              const total = t.frozen_total ?? 0
              const done = t.frozen_completed ?? 0
              const pct = total > 0 ? Math.round((done / total) * 100) : 0
              return (
                <div key={t.id} className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 opacity-80">
                  <h4 className="text-slate-200 font-semibold">{t.from_course_title ?? 'Course'}</h4>
                  <p className="text-slate-500 text-xs mt-0.5">Group: {t.from_group_name}</p>
                  <div className="mt-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-slate-500">Frozen progress</span>
                      <span className="text-xs text-slate-400">{pct}%</span>
                    </div>
                    <div className="w-full bg-slate-800 rounded-full h-1.5">
                      <div className="bg-slate-500 h-1.5 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="text-xs text-slate-500 mt-1">{done} / {total} items completed</p>
                  </div>
                  <p className="text-slate-500 text-xs mt-3">
                    Moved {formatDate(t.created_at)}{t.to_course_title ? ` → ${t.to_course_title}` : ''}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
