'use client'

import { Users, ClipboardList, BookOpen } from 'lucide-react'
import { DemoStatCard, DemoCard } from '@/components/demo/demo-shell'
import { useTranslations, useLocale } from 'next-intl'
import type { Locale } from '@/i18n/config'
import { getDemoData } from '@/lib/demo/data'

export default function DemoTeacherDashboard() {
  const t = useTranslations('public.demo')
  const d = getDemoData(useLocale() as Locale)
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">{t('teacher.title')}</h2>
        <p className="text-slate-400 mt-1">{t('common.welcome', { name: d.teachers[0].name })}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <DemoStatCard label={t('teacher.myGroups')} value={d.teacherGroups.length} icon={Users} color="text-blue-400" bg="bg-blue-500/10" />
        <DemoStatCard label={t('teacher.publishedLessons')} value={12} icon={BookOpen} color="text-violet-400" bg="bg-violet-500/10" />
        <DemoStatCard label={t('teacher.myExams')} value={d.exams.length} icon={ClipboardList} color="text-amber-400" bg="bg-amber-500/10" />
      </div>

      <DemoCard title={t('teacher.upcomingExams')}>
        <ul className="space-y-3">
          {d.exams.map((e) => (
            <li key={e.id} className="flex items-center justify-between">
              <div>
                <p className="text-white text-sm font-medium">{e.title}</p>
                <p className="text-slate-500 text-xs">{t('teacher.examMeta', { date: e.date, count: e.duration })}</p>
              </div>
              <span className="text-xs text-slate-400">{t('common.submissionsCount', { count: e.submissions })}</span>
            </li>
          ))}
        </ul>
      </DemoCard>
    </div>
  )
}
