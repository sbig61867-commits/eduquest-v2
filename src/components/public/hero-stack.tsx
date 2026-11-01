'use client'

import { useLocale, useTranslations } from 'next-intl'
import type { Locale } from '@/i18n/config'
import { getDemoData } from '@/lib/demo/data'

// The home hero's product view: three role screens (administration, teacher,
// student) stacked in depth, the front one fully lit. Numbers come from the
// /demo fixtures (src/lib/demo/data.ts) so they match the demo tour. It is an
// illustration: aria-hidden and inert. `.eq-pub-stack` (globals.css) restores
// the light surface tokens inside the dark hero.
function Win({ title, children, className }: { title: string; children: React.ReactNode; className: string }) {
  return (
    <div className={`absolute rounded-lg border border-line bg-surface shadow-overlay overflow-hidden ${className}`}>
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-line bg-canvas">
        <span className="w-2 h-2 rounded-full bg-line-strong" />
        <span className="w-2 h-2 rounded-full bg-line-strong" />
        <span className="w-2 h-2 rounded-full bg-line-strong" />
        <span className="ms-2 text-fg-3 text-xs truncate">{title}</span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md bg-canvas px-3 py-2">
      <p className="text-fg-3 text-xs truncate">{label}</p>
      <p className="text-accent text-lg font-bold tabular-nums">{value}</p>
    </div>
  )
}

export function HeroStack() {
  const t = useTranslations('public.landing.stack')
  const d = getDemoData(useLocale() as Locale)
  const graded = d.exams.find(e => e.status === 'graded')
  const next = d.upcomingExams[0]
  const me = d.students[0]
  return (
    <div aria-hidden="true" inert className="eq-pub-stack relative h-80 sm:h-96 select-none">
      <Win title={t('admin')} className="top-0 end-0 w-[78%] opacity-60 scale-95 origin-top-right">
        <div className="grid grid-cols-3 gap-2">
          <Stat label={t('students')} value={d.stats.students} />
          <Stat label={t('teachers')} value={d.stats.teachers} />
          <Stat label={t('courses')} value={d.stats.courses} />
        </div>
      </Win>
      <Win title={t('teacher')} className="top-14 sm:top-16 end-[8%] w-[78%] opacity-85 scale-[0.975] origin-top-right">
        <div className="grid grid-cols-2 gap-2">
          <Stat label={t('submissions')} value={graded?.submissions ?? 0} />
          <Stat label={t('groups')} value={d.teacherGroups.length} />
        </div>
        {graded && <p className="mt-3 text-fg-2 text-sm truncate">{graded.title}</p>}
      </Win>
      <Win title={t('student')} className="top-32 sm:top-36 end-[16%] w-[78%]">
        <div className="grid grid-cols-2 gap-2">
          <Stat label={t('average')} value={<span dir="ltr">{me.avgGrade}%</span>} />
          <Stat label={t('upcoming')} value={d.upcomingExams.length} />
        </div>
        {next && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2">
            <span className="text-fg text-sm font-semibold truncate">{next.title}</span>
            <span className="shrink-0 rounded-full bg-accent-subtle text-accent text-xs font-semibold px-2.5 py-0.5">{t('open')}</span>
          </div>
        )}
      </Win>
    </div>
  )
}
