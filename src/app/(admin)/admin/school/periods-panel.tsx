'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Archive, BellRing, Pencil, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { confirmDialog } from '@/lib/confirm-dialog'
import { cn } from '@/lib/utils'
import { SECTION_SHIFTS, type SectionShift } from '@/lib/school-structure'
import { TIMETABLE_LIMITS, hhmm, lessonNumbers, type SchoolPeriod } from '@/lib/school-timetable'
import { PeriodForm } from './curriculum-forms'
import { sendSchool, tag } from './school-ui'

// الحصص: the bell schedule. One list per shift: the general one (every shift)
// and, when the school runs shifts, a morning and an evening one. A section
// follows its shift's list when the school defined one, else the general list.
export function PeriodsPanel({ periods, onChange }: {
  periods: SchoolPeriod[]
  onChange: (work: () => Promise<unknown>) => Promise<boolean>
}) {
  const t = useTranslations('admin.schoolTimetable')
  const [shift, setShift] = useState<SectionShift | null>(null)
  const [form, setForm] = useState<{ period?: SchoolPeriod } | null>(null)
  const list = periods.filter(p => p.shift === shift).sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  const numbers = lessonNumbers(list)
  const iconButton = 'eq-focus p-1.5 rounded-control text-fg-3 hover:text-fg hover:bg-elevated'
  const pill = (active: boolean) => cn(
    'eq-focus px-3 py-1.5 rounded-control text-body-sm border transition-colors',
    active ? 'bg-accent-subtle border-accent text-accent' : 'bg-surface border-line text-fg-2 hover:text-fg',
  )

  async function archive(p: SchoolPeriod) {
    const label = p.name ?? (p.kind === 'break' ? t('periodKinds.break') : t('lessonNo', { no: numbers.get(p.id) ?? 0 }))
    if (!(await confirmDialog(t('archivePeriodConfirm', { name: label })))) return
    await onChange(() => sendSchool('/api/school/periods', 'DELETE', { id: p.id }))
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('bellFor')}>
          {([null, ...SECTION_SHIFTS] as const).map(s => (
            <button key={s ?? 'all'} type="button" className={pill(shift === s)} aria-pressed={shift === s} onClick={() => setShift(s)}>
              {s ? t(`shifts.${s}`) : t('shiftAll')}
            </button>
          ))}
        </div>
        <Button onClick={() => setForm({})} disabled={list.length >= TIMETABLE_LIMITS.periodsPerShift}>
          <Plus className="w-4 h-4" /> {t('addPeriod')}
        </Button>
      </div>
      <p className="text-meta text-fg-3">{t('bellHint')}</p>

      <section className="bg-surface border border-line rounded-overlay">
        {list.length === 0 ? (
          <div className="p-6 text-center">
            <BellRing className="w-8 h-8 text-fg-3 mx-auto mb-3" aria-hidden="true" />
            <p className="text-fg-2 text-body-sm">{t('noPeriods')}</p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {list.map(p => (
              <li key={p.id} className={cn('flex flex-wrap items-center justify-between gap-3 px-4 py-3', p.kind === 'break' && 'bg-elevated')}>
                <div className="min-w-0 flex flex-wrap items-center gap-2">
                  <span className="text-fg text-body-sm font-medium tabular-nums">{t('timeRange', { start: hhmm(p.starts_at), end: hhmm(p.ends_at) })}</span>
                  {p.kind === 'lesson' ? tag(t('lessonNo', { no: numbers.get(p.id) ?? 0 })) : tag(t('periodKinds.break'))}
                  {p.name && <span className="text-fg-2 text-body-sm truncate">{p.name}</span>}
                </div>
                <div className="flex items-center gap-1">
                  <button className={iconButton} aria-label={t('edit')} onClick={() => setForm({ period: p })}><Pencil className="w-4 h-4" /></button>
                  <button className={iconButton} aria-label={t('archive')} onClick={() => archive(p)}><Archive className="w-4 h-4" /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {form && (
        <PeriodForm period={form.period} shift={shift} onClose={() => setForm(null)}
          onSaved={() => { setForm(null); void onChange(async () => undefined) }} />
      )}
    </div>
  )
}
