export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Users, BookOpen, ClipboardList, Eye, EyeOff, Clock } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import Link from 'next/link'

interface RecentLesson { id: string; title: string; is_published: boolean; created_at: string; groups: { name: string } | null }
interface UpcomingExam  { id: string; title: string; ends_at: string | null; groups: { name: string } | null }

export default async function TeacherDashboard() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  const [
    { count: groups },
    { count: lessons },
    { count: exams },
    { count: ungraded },
    { data: recentLessons },
    { data: upcomingExams },
  ] = await Promise.all([
    supabase.from('groups').select('*', { count: 'exact', head: true }).eq('teacher_id', user.id).is('deleted_at', null),
    supabase.from('lessons').select('*', { count: 'exact', head: true }).eq('teacher_id', user.id).is('deleted_at', null),
    supabase.from('exams').select('*', { count: 'exact', head: true }).eq('teacher_id', user.id).is('deleted_at', null),
    supabase.from('exam_submissions').select('*', { count: 'exact', head: true }).eq('teacher_id', user.id).eq('status', 'submitted'),
    supabase.from('lessons')
      .select('id, title, is_published, created_at, groups(name)')
      .eq('teacher_id', user.id).is('deleted_at', null)
      .order('created_at', { ascending: false }).limit(6),
    supabase.from('exams')
      .select('id, title, ends_at, groups(name)')
      .eq('teacher_id', user.id).is('deleted_at', null)
      .eq('is_published', true)
      .gte('ends_at', new Date().toISOString())
      .order('ends_at', { ascending: true }).limit(5),
  ])

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-fg">Dashboard</h1>

      {/* Slim stat strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Groups', value: groups ?? 0, href: '/teacher/groups', icon: Users },
          { label: 'Lessons', value: lessons ?? 0, href: '/teacher/lessons', icon: BookOpen },
          { label: 'Exams', value: exams ?? 0, href: '/teacher/exams', icon: ClipboardList },
          { label: 'Ungraded', value: ungraded ?? 0, href: '/teacher/grades', icon: Clock },
        ].map(({ label, value, href, icon: Icon }) => (
          <Link key={label} href={href}
            className="flex items-center gap-3 bg-surface border border-border rounded-lg px-4 py-3 hover:border-border-strong transition-colors">
            <Icon className="w-4 h-4 text-accent shrink-0" />
            <div>
              <p className="text-lg font-semibold text-fg leading-none">{value}</p>
              <p className="text-xs text-fg-muted mt-0.5">{label}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* Row 2: Work queue (8) + Agenda (4) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-8 bg-surface border border-border rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-fg">Recent Lessons</h2>
            <Link href="/teacher/lessons" className="text-xs text-accent hover:text-accent-hover transition-colors">View all</Link>
          </div>
          {!recentLessons?.length ? (
            <p className="text-fg-muted text-sm">No lessons yet.{' '}
              <Link href="/teacher/lessons" className="text-accent hover:underline">Create your first lesson.</Link>
            </p>
          ) : (
            <div className="divide-y divide-border">
              {(recentLessons as unknown as RecentLesson[]).map(l => (
                <Link key={l.id} href={`/teacher/lessons/${l.id}`}
                  className="flex items-center justify-between gap-3 py-2.5 group">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-fg truncate group-hover:text-accent transition-colors">{l.title}</p>
                    <p className="text-xs text-fg-muted">{l.groups?.name ?? '—'} · {formatDate(l.created_at)}</p>
                  </div>
                  {l.is_published
                    ? <Eye className="w-3.5 h-3.5 text-accent shrink-0" />
                    : <EyeOff className="w-3.5 h-3.5 text-fg-muted shrink-0" />}
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-4 bg-surface border border-border rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-fg">Upcoming Exams</h2>
            <Link href="/teacher/exams" className="text-xs text-accent hover:text-accent-hover transition-colors">View all</Link>
          </div>
          {!upcomingExams?.length ? (
            <p className="text-fg-muted text-sm">No upcoming exams.{' '}
              <Link href="/teacher/exams" className="text-accent hover:underline">Create an exam.</Link>
            </p>
          ) : (
            <div className="divide-y divide-border">
              {(upcomingExams as unknown as UpcomingExam[]).map(e => (
                <div key={e.id} className="py-2.5">
                  <p className="text-sm font-medium text-fg truncate">{e.title}</p>
                  <p className="text-xs text-fg-muted">{e.groups?.name ?? '—'}</p>
                  {e.ends_at && (
                    <p className="text-xs text-accent mt-0.5">{formatDate(e.ends_at)}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
