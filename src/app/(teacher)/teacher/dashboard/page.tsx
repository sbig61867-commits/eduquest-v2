export const dynamic = 'force-dynamic'

import { currentUser } from '@/lib/auth/current'
import { run } from '@/lib/db/sql'
import { redirect } from 'next/navigation'
import { Users, BookOpen, ClipboardList, Eye, EyeOff, Clock } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import Link from 'next/link'
import { AnnouncementsBanner, type StudentAnnouncement } from '@/components/student/announcements-banner'
import { isAnnouncementLive } from '@/lib/announcement-window'
import { getTranslations, getLocale } from 'next-intl/server'
import type { Locale } from '@/i18n/config'

interface RecentLesson { id: string; title: string; is_published: boolean; created_at: string; groups: { name: string } | null }
interface UpcomingExam  { id: string; title: string; ends_at: string | null; groups: { name: string } | null }

export default async function TeacherDashboard() {
  const user = await currentUser()
  if (!user) redirect('/login')
  const t = await getTranslations('teacher')
  const locale = (await getLocale()) as Locale

  const tenantId = user.tenant_id ?? null
  const [countRows, recentRows, upcomingRows, announcementRows] = await run({ as: 'user', userId: user.id }, sql => [
    sql`select (select count(*)::int from public.groups where teacher_id = ${user.id} and deleted_at is null) as groups,
               (select count(*)::int from public.lessons where teacher_id = ${user.id} and deleted_at is null) as lessons,
               (select count(*)::int from public.exams where teacher_id = ${user.id} and deleted_at is null) as exams`,
    sql`select l.id, l.title, l.is_published, l.created_at,
               case when g.id is null then null else json_build_object('name', g.name) end as groups
          from public.lessons l left join public.groups g on g.id = l.group_id
         where l.teacher_id = ${user.id} and l.deleted_at is null order by l.created_at desc limit 5`,
    sql`select e.id, e.title, e.ends_at,
               case when g.id is null then null else json_build_object('name', g.name) end as groups
          from public.exams e left join public.groups g on g.id = e.group_id
         where e.teacher_id = ${user.id} and e.deleted_at is null and e.is_published and e.ends_at >= now()
         order by e.ends_at limit 5`,
    sql`select id, title, body, image_url, link_url, cta_label, is_published, starts_at, ends_at
          from public.announcements where tenant_id = ${tenantId} and is_published order by created_at desc limit 20`,
  ])
  const { groups, lessons, exams } = countRows[0] as unknown as { groups: number; lessons: number; exams: number }
  const recentLessons = recentRows as unknown as RecentLesson[]
  const upcomingExams = upcomingRows as unknown as UpcomingExam[]
  const liveAnnouncements = (announcementRows as unknown as (StudentAnnouncement & { is_published: boolean; starts_at: string | null; ends_at: string | null })[]).filter(a => isAnnouncementLive(a)) as StudentAnnouncement[]

  const cards = [
    { label: t('dashboard.cards.groups'),   value: groups  ?? 0, icon: Users,        color: 'text-blue-400',   bg: 'bg-blue-500/10',   href: '/teacher/groups'  },
    { label: t('dashboard.cards.lessons'),  value: lessons ?? 0, icon: BookOpen,     color: 'text-emerald-400',bg: 'bg-emerald-500/10',href: '/teacher/lessons' },
    { label: t('dashboard.cards.exams'),    value: exams   ?? 0, icon: ClipboardList,color: 'text-violet-400', bg: 'bg-violet-500/10', href: '/teacher/exams'   },
    { label: t('dashboard.cards.upcoming'), value: upcomingExams?.length ?? 0, icon: Clock, color: 'text-amber-400', bg: 'bg-amber-500/10', href: '/teacher/exams' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">{t('dashboard.title')}</h2>
        <p className="text-slate-400 mt-1">{t('dashboard.subtitle')}</p>
      </div>

      <AnnouncementsBanner announcements={liveAnnouncements} />

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
            <h3 className="text-white font-semibold">{t('dashboard.recentLessons')}</h3>
            <Link href="/teacher/lessons" className="text-blue-400 hover:text-blue-300 text-xs transition-colors">{t('dashboard.viewAll')}</Link>
          </div>
          {!recentLessons?.length ? (
            <p className="text-slate-500 text-sm">{t('dashboard.noLessons')} <Link href="/teacher/lessons" className="text-blue-400 hover:underline">{t('dashboard.noLessonsLink')}</Link></p>
          ) : (
            <div className="space-y-2">
              {(recentLessons as unknown as RecentLesson[]).map(l => (
                <Link key={l.id} href={`/teacher/lessons/${l.id}`}
                  className="flex items-center justify-between gap-3 py-2 border-b border-slate-800 last:border-0 hover:text-white transition-colors group">
                  <div className="min-w-0">
                    <p className="text-slate-200 text-sm font-medium truncate group-hover:text-white">{l.title}</p>
                    <p className="text-slate-500 text-xs">{l.groups?.name ?? '—'} · {formatDate(l.created_at, locale)}</p>
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
            <h3 className="text-white font-semibold">{t('dashboard.upcomingExams')}</h3>
            <Link href="/teacher/exams" className="text-blue-400 hover:text-blue-300 text-xs transition-colors">{t('dashboard.viewAll')}</Link>
          </div>
          {!upcomingExams?.length ? (
            <p className="text-slate-500 text-sm">{t('dashboard.noUpcoming')} <Link href="/teacher/exams" className="text-blue-400 hover:underline">{t('dashboard.noUpcomingLink')}</Link></p>
          ) : (
            <div className="space-y-2">
              {(upcomingExams as unknown as UpcomingExam[]).map(e => (
                <div key={e.id} className="flex items-center justify-between gap-3 py-2 border-b border-slate-800 last:border-0">
                  <div className="min-w-0">
                    <p className="text-slate-200 text-sm font-medium truncate">{e.title}</p>
                    <p className="text-slate-500 text-xs">{e.groups?.name ?? '—'}</p>
                  </div>
                  {e.ends_at && (
                    <span className="text-amber-400 text-xs shrink-0">{formatDate(e.ends_at, locale)}</span>
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
