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
    { data: recentLessons },
    { data: upcomingExams },
  ] = await Promise.all([
    supabase.from('groups').select('*', { count: 'exact', head: true }).eq('teacher_id', user.id).is('deleted_at', null),
    supabase.from('lessons').select('*', { count: 'exact', head: true }).eq('teacher_id', user.id).is('deleted_at', null),
    supabase.from('exams').select('*', { count: 'exact', head: true }).eq('teacher_id', user.id).is('deleted_at', null),
    supabase.from('lessons')
      .select('id, title, is_published, created_at, groups(name)')
      .eq('teacher_id', user.id).is('deleted_at', null)
      .order('created_at', { ascending: false }).limit(5),
    supabase.from('exams')
      .select('id, title, ends_at, groups(name)')
      .eq('teacher_id', user.id).is('deleted_at', null)
      .eq('is_published', true)
      .gte('ends_at', new Date().toISOString())
      .order('ends_at', { ascending: true }).limit(5),
  ])

  const cards = [
    { label: 'My Groups',       value: groups  ?? 0, icon: Users,        color: 'text-blue-400',   bg: 'bg-blue-500/10',   href: '/teacher/groups'  },
    { label: 'Lessons Created', value: lessons ?? 0, icon: BookOpen,     color: 'text-emerald-400',bg: 'bg-emerald-500/10',href: '/teacher/lessons' },
    { label: 'Exams Created',   value: exams   ?? 0, icon: ClipboardList,color: 'text-violet-400', bg: 'bg-violet-500/10', href: '/teacher/exams'   },
    { label: 'Upcoming Exams',  value: upcomingExams?.length ?? 0, icon: Clock, color: 'text-amber-400', bg: 'bg-amber-500/10', href: '/teacher/exams' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Teacher Dashboard</h2>
        <p className="text-slate-400 mt-1">Manage your groups, lessons, and exams</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((card) => {
          const Icon = card.icon
          return (
            <Link key={card.label} href={card.href} className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition-colors block">
              <div className="flex items-center justify-between mb-4">
                <p className="text-slate-400 text-sm">{card.label}</p>
                <div className={`p-2 rounded-lg ${card.bg}`}>
                  <Icon className={`w-5 h-5 ${card.color}`} />
                </div>
              </div>
              <p className="text-3xl font-bold text-white">{card.value}</p>
            </Link>
          )
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent Lessons */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-white font-semibold">Recent Lessons</h3>
            <Link href="/teacher/lessons" className="text-blue-400 hover:text-blue-300 text-xs transition-colors">View all →</Link>
          </div>
          {!recentLessons?.length ? (
            <p className="text-slate-500 text-sm">No lessons yet. <Link href="/teacher/lessons" className="text-blue-400 hover:underline">Create your first lesson.</Link></p>
          ) : (
            <div className="space-y-2">
              {(recentLessons as unknown as RecentLesson[]).map(l => (
                <Link key={l.id} href={`/teacher/lessons/${l.id}`}
                  className="flex items-center justify-between gap-3 py-2 border-b border-slate-800 last:border-0 hover:text-white transition-colors group">
                  <div className="min-w-0">
                    <p className="text-slate-200 text-sm font-medium truncate group-hover:text-white">{l.title}</p>
                    <p className="text-slate-500 text-xs">{l.groups?.name ?? '—'} · {formatDate(l.created_at)}</p>
                  </div>
                  {l.is_published
                    ? <Eye className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    : <EyeOff className="w-3.5 h-3.5 text-slate-600 shrink-0" />}
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Upcoming Exams */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-white font-semibold">Upcoming Exams</h3>
            <Link href="/teacher/exams" className="text-blue-400 hover:text-blue-300 text-xs transition-colors">View all →</Link>
          </div>
          {!upcomingExams?.length ? (
            <p className="text-slate-500 text-sm">No upcoming exams. <Link href="/teacher/exams" className="text-blue-400 hover:underline">Create an exam.</Link></p>
          ) : (
            <div className="space-y-2">
              {(upcomingExams as unknown as UpcomingExam[]).map(e => (
                <div key={e.id} className="flex items-center justify-between gap-3 py-2 border-b border-slate-800 last:border-0">
                  <div className="min-w-0">
                    <p className="text-slate-200 text-sm font-medium truncate">{e.title}</p>
                    <p className="text-slate-500 text-xs">{e.groups?.name ?? '—'}</p>
                  </div>
                  {e.ends_at && (
                    <span className="text-amber-400 text-xs shrink-0">{formatDate(e.ends_at)}</span>
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
