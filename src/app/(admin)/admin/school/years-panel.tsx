'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { Plus, Pencil, Archive, CalendarRange, Star } from 'lucide-react'
import type { Locale } from '@/i18n/config'
import { Button } from '@/components/ui/button'
import { confirmDialog } from '@/lib/confirm-dialog'
import { formatDate } from '@/lib/utils'
import { SCHOOL_LIMITS, type SchoolTerm, type SchoolYear } from '@/lib/school-structure'
import { TermForm, YearForm, type FormState } from './school-forms'
import { sendSchool, tag } from './school-ui'

// السنة الدراسية: the school's years (one active) and each year's terms.
export function YearsPanel({ years, terms, onChange }: {
  years: SchoolYear[]
  terms: SchoolTerm[]
  onChange: (work: () => Promise<unknown>) => Promise<boolean>
}) {
  const t = useTranslations('admin.schoolClient')
  const locale = useLocale() as Locale
  const router = useRouter()
  const [form, setForm] = useState<FormState | null>(null)
  const termsOf = (yearId: string) => terms.filter(x => x.year_id === yearId).sort((a, b) => a.term_no - b.term_no)
  const range = (a: string, b: string) => t('dateRange', { start: formatDate(a, locale), end: formatDate(b, locale) })
  const iconButton = 'eq-focus p-1.5 rounded-control text-fg-3 hover:text-fg hover:bg-elevated'
  const saved = () => { setForm(null); router.refresh() }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setForm({ kind: 'year' })}><Plus className="w-4 h-4" /> {t('addYear')}</Button>
      </div>

      {years.length === 0 ? (
        <div className="bg-surface border border-line rounded-overlay p-6 text-center">
          <CalendarRange className="w-8 h-8 text-fg-3 mx-auto mb-3" aria-hidden="true" />
          <p className="text-fg-2 text-body-sm">{t('noYears')}</p>
        </div>
      ) : years.map(year => (
        <section key={year.id} className="bg-surface border border-line rounded-overlay">
          <header className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-line">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2">
                <span className="text-h3 text-fg">{year.name}</span>
                {year.is_active && tag(t('active'), 'success')}
              </p>
              <p className="text-meta text-fg-3 mt-0.5">{range(year.starts_on, year.ends_on)}</p>
            </div>
            <div className="flex items-center gap-1">
              {!year.is_active && (
                <Button variant="ghost" size="sm"
                  onClick={() => onChange(() => sendSchool('/api/school/structure', 'PATCH', { kind: 'year', id: year.id, is_active: true }))}>
                  <Star className="w-4 h-4" /> {t('activate')}
                </Button>
              )}
              <Button variant="ghost" size="sm" disabled={termsOf(year.id).length >= SCHOOL_LIMITS.termsPerYear}
                onClick={() => setForm({ kind: 'term', yearId: year.id, nextNo: termsOf(year.id).length + 1 })}>
                <Plus className="w-4 h-4" /> {t('addTerm')}
              </Button>
              <button className={iconButton} aria-label={t('edit')} onClick={() => setForm({ kind: 'year', year })}><Pencil className="w-4 h-4" /></button>
              <button className={iconButton} aria-label={t('archive')}
                onClick={async () => {
                  if (await confirmDialog(t('archiveYearConfirm', { name: year.name }))) {
                    await onChange(() => sendSchool('/api/school/structure', 'DELETE', { kind: 'year', id: year.id }))
                  }
                }}><Archive className="w-4 h-4" /></button>
            </div>
          </header>
          {termsOf(year.id).length === 0 ? (
            <p className="p-4 text-fg-3 text-body-sm">{t('noTerms')}</p>
          ) : (
            <ul className="divide-y divide-line">
              {termsOf(year.id).map(term => (
                <li key={term.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-fg text-body-sm font-medium">{t('termTitle', { no: term.term_no, name: term.name })}</p>
                    <p className="text-meta text-fg-3">{range(term.starts_on, term.ends_on)}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button className={iconButton} aria-label={t('edit')} onClick={() => setForm({ kind: 'term', yearId: year.id, term })}><Pencil className="w-4 h-4" /></button>
                    <button className={iconButton} aria-label={t('archive')}
                      onClick={async () => {
                        if (await confirmDialog(t('archiveTermConfirm', { name: term.name }))) {
                          await onChange(() => sendSchool('/api/school/structure', 'DELETE', { kind: 'term', id: term.id }))
                        }
                      }}><Archive className="w-4 h-4" /></button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      {form?.kind === 'year' && <YearForm state={form} onClose={() => setForm(null)} onSaved={saved} />}
      {form?.kind === 'term' && <TermForm state={form} onClose={() => setForm(null)} onSaved={saved} />}
    </div>
  )
}
