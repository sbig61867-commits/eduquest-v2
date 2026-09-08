export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Users, BookOpen, ClipboardList, Clock, Eye, EyeOff } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import Link from 'next/link'
import { PageTitle } from '@/components/shared/page-title'

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
      .order('created_at', { ascending: false }).limit(8),
    supabase.from('exams')
      .select('id, title, ends_at, groups(name)')
      .eq('teacher_id', user.id).is('deleted_at', null)
      .eq('is_published', true)
      .gte('ends_at', new Date().toISOString())
      .order('ends_at', { ascending: true }).limit(5),
  ])

  const stats = [
    { label: 'Groups',   value: groups   ?? 0, href: '/teacher/groups',  icon: Users },
    { label: 'Lessons',  value: lessons  ?? 0, href: '/teacher/lessons', icon: BookOpen },
    { label: 'Exams',    value: exams    ?? 0, href: '/teacher/exams',   icon: ClipboardList },
    { label: 'Ungraded', value: ungraded ?? 0, href: '/teacher/grades',  icon: Clock },
  ]

  return (
    <>
      <PageTitle title="Dashboard" />

      <div className="max-w-5xl mx-auto">
        {/* Stat strip — text-only, no decorative cards */}
        <div className="flex items-center gap-6 mb-8 pb-7 border-b border-border flex-wrap">
          {stats.map(({ label, value, href, icon: Icon }, i) => (
            <>
              {i > 0 && <div key={`div-${label}`} className="w-px h-8 bg-border hidden sm:block" aria-hidden="true" />}
              <Link key={label} href={href} className="group">
                <p className="text-2xl font-semibold text-fg group-hover:text-accent transition-colors leading-none">
                  {value}
                </p>
                <p className="flex items-center gap-1.5 text-[12px] text-fg-muted mt-1">
                  <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                  {label}
                </p>
              </Link>
            </>
          ))}
        </div>

        {/* Work queue + agenda — 8/4 split */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">

          {/* Lessons work queue */}
          <div className="lg:col-span-8 bg-surface border border-border rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="text-[13px] font-semibold text-fg">Recent Lessons</h2>
              <Link href="/teacher/lessons" className="text-[12px] text-accent hover:text-accent-hover transition-colors">
                View all
              </Link>
            </div>
            {!recentLessons?.length ? (
              <div className="px-5 py-8">
                <p className="text-[13px] text-fg-muted">
                  No lessons yet.{' '}
                  <Link href="/teacher/lessons" className="text-accent hover:text-accent-hover transition-colors">
                    Create your first lesson →
                  </Link>
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {(recentLessons as unknown as RecentLesson[]).map(l => (
                  <li key={l.id}>
                    <Link href={`/teacher/lessons/${l.id}`}
                      className="flex items-center gap-3 px-5 py-3.5 hover:bg-canvas transition-colors group">
                      {l.is_published
                        ? <Eye className="w-3.5 h-3.5 text-accent shrink-0" aria-hidden="true" />
                        : <EyeOff className="w-3.5 h-3.5 text-fg-muted shrink-0" aria-hidden="true" />}
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-fg truncate group-hover:text-accent transition-colors">
                          {l.title}
                        </p>
                        <p className="text-[11px] text-fg-muted mt-0.5">
                          {l.groups?.name ?? '—'} · {formatDate(l.created_at)}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Upcoming exams */}
          <div className="lg:col-span-4 bg-surface border border-border rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="text-[13px] font-semibold text-fg">Upcoming Exams</h2>
              <Link href="/teacher/exams" className="text-[12px] text-accent hover:text-accent-hover transition-colors">
                View all
              </Link>
            </div>
            {!upcomingExams?.length ? (
              <div className="px-5 py-8">
                <p className="text-[13px] text-fg-muted">
                  No upcoming exams.{' '}
                  <Link href="/teacher/exams" className="text-accent hover:text-accent-hover transition-colors">
                    Create an exam →
                  </Link>
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {(upcomingExams as unknown as UpcomingExam[]).map(e => (
                  <li key={e.id} className="px-5 py-3.5">
                    <p className="text-[13px] font-medium text-fg truncate">{e.title}</p>
                    <p className="text-[11px] text-fg-muted mt-0.5">{e.groups?.name ?? '—'}</p>
                    {e.ends_at && (
                      <p className="text-[11px] text-accent mt-0.5">{formatDate(e.ends_at)}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
