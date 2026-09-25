'use client'

import { GraduationCap, Users, BookOpen, ClipboardList } from 'lucide-react'
import { DemoStatCard, DemoCard } from '@/components/demo/demo-shell'
import { useTranslations, useLocale } from 'next-intl'
import type { Locale } from '@/i18n/config'
import { getDemoData } from '@/lib/demo/data'

export default function DemoAdminDashboard() {
  const t = useTranslations('public.demo')
  const d = getDemoData(useLocale() as Locale)
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">{t('admin.title')}</h2>
        <p className="text-slate-400 mt-1">{t('admin.subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <DemoStatCard label={t('admin.teachers')} value={d.stats.teachers} icon={GraduationCap} color="text-blue-400" bg="bg-blue-500/10" />
        <DemoStatCard label={t('admin.students')} value={d.stats.students} icon={Users} color="text-emerald-400" bg="bg-emerald-500/10" />
        <DemoStatCard label={t('admin.courses')} value={d.stats.courses} icon={BookOpen} color="text-violet-400" bg="bg-violet-500/10" />
        <DemoStatCard label={t('admin.exams')} value={d.stats.exams} icon={ClipboardList} color="text-amber-400" bg="bg-amber-500/10" />
      </div>

      <DemoCard title={t('admin.latestCourses')}>
        <ul className="space-y-3">
          {d.courses.map((c) => (
            <li key={c.id} className="flex items-center justify-between">
              <div>
                <p className="text-white text-sm font-medium">{c.title}</p>
                <p className="text-slate-500 text-xs">{c.level} · {t('common.units', { count: c.units })}</p>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full ${c.published ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-800 text-slate-400'}`}>
                {c.published ? t('common.published') : t('common.draft')}
              </span>
            </li>
          ))}
        </ul>
      </DemoCard>
    </div>
  )
}
