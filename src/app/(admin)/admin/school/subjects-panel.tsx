'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Archive, BookOpen, Pencil, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { confirmDialog } from '@/lib/confirm-dialog'
import { cn } from '@/lib/utils'
import type { SchoolGrade, SchoolStage } from '@/lib/school-structure'
import { TIMETABLE_LIMITS, type GradeSubject, type SchoolSubject } from '@/lib/school-timetable'
import { SubjectForm } from './curriculum-forms'
import { fieldClass, labelClass, sendSchool, subjectTone } from './school-ui'

// المواد: the school's subject catalogue, and per stage the grade × subject
// matrix of weekly sessions (empty or 0 = not taught in that grade).
export function SubjectsPanel({ stages, grades, subjects, gradeSubjects, onChange }: {
  stages: SchoolStage[]
  grades: SchoolGrade[]
  subjects: SchoolSubject[]
  gradeSubjects: GradeSubject[]
  onChange: (work: () => Promise<unknown>) => Promise<boolean>
}) {
  const t = useTranslations('admin.schoolTimetable')
  const [form, setForm] = useState<{ subject?: SchoolSubject } | null>(null)
  const [stageId, setStageId] = useState(stages[0]?.id ?? '')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const iconButton = 'eq-focus p-1.5 rounded-control text-fg-3 hover:text-fg hover:bg-elevated'

  const sessions = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of gradeSubjects) m.set(`${l.grade_id}:${l.subject_id}`, l.weekly_sessions)
    return m
  }, [gradeSubjects])
  const stageGrades = grades.filter(g => g.stage_id === stageId)

  async function saveCell(gradeId: string, subjectId: string) {
    const key = `${gradeId}:${subjectId}`
    const raw = drafts[key]
    if (raw === undefined) return
    const value = raw.trim() === '' ? 0 : Number(raw)
    if ((sessions.get(key) ?? 0) === value) {
      setDrafts(d => { const { [key]: _drop, ...rest } = d; return (void _drop, rest) })
      return
    }
    if (!Number.isInteger(value) || value < 0 || value > TIMETABLE_LIMITS.weeklySessionsMax) {
      toast(t('sessionsRange', { max: TIMETABLE_LIMITS.weeklySessionsMax }), 'error')
      return
    }
    const ok = await onChange(() => sendSchool('/api/school/subjects', 'POST', {
      kind: 'gradeSubject', grade_id: gradeId, subject_id: subjectId, weekly_sessions: value,
    }))
    if (ok) setDrafts(d => { const { [key]: _drop, ...rest } = d; return (void _drop, rest) })
  }

  async function archive(subject: SchoolSubject) {
    if (!(await confirmDialog(t('archiveSubjectConfirm', { name: subject.name })))) return
    await onChange(() => sendSchool('/api/school/subjects', 'DELETE', { kind: 'subject', id: subject.id }))
  }

  return (
    <div className="space-y-6">
      <section className="bg-surface border border-line rounded-overlay">
        <header className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-line">
          <div>
            <h3 className="text-h3 text-fg">{t('catalogueTitle')}</h3>
            <p className="text-meta text-fg-3 mt-0.5">{t('catalogueHint')}</p>
          </div>
          <Button onClick={() => setForm({})} disabled={subjects.length >= TIMETABLE_LIMITS.subjects}>
            <Plus className="w-4 h-4" /> {t('addSubject')}
          </Button>
        </header>
        {subjects.length === 0 ? (
          <div className="p-6 text-center">
            <BookOpen className="w-8 h-8 text-fg-3 mx-auto mb-3" aria-hidden="true" />
            <p className="text-fg-2 text-body-sm">{t('noSubjects')}</p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {subjects.map(subject => (
              <li key={subject.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0 flex flex-wrap items-center gap-2">
                  <span className={cn('inline-flex items-center px-2 py-0.5 rounded-control border text-label', subjectTone(subject.colour))}>
                    {subject.code}
                  </span>
                  <span className="text-fg text-body-sm font-medium truncate">{subject.name}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button className={iconButton} aria-label={t('edit')} onClick={() => setForm({ subject })}><Pencil className="w-4 h-4" /></button>
                  <button className={iconButton} aria-label={t('archive')} onClick={() => archive(subject)}><Archive className="w-4 h-4" /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-surface border border-line rounded-overlay">
        <header className="flex flex-wrap items-end justify-between gap-3 p-4 border-b border-line">
          <div>
            <h3 className="text-h3 text-fg">{t('matrixTitle')}</h3>
            <p className="text-meta text-fg-3 mt-0.5">{t('matrixHint')}</p>
          </div>
          {stages.length > 0 && (
            <label className="block">
              <span className={labelClass}>{t('stage')}</span>
              <select className={fieldClass} value={stageId} onChange={e => setStageId(e.target.value)}>
                {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          )}
        </header>
        {stages.length === 0 || stageGrades.length === 0 ? (
          <p className="p-4 text-fg-3 text-body-sm">{t('matrixNoGrades')}</p>
        ) : subjects.length === 0 ? (
          <p className="p-4 text-fg-3 text-body-sm">{t('matrixNoSubjects')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-body-sm">
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="px-3 py-2 text-start text-label text-fg-2 sticky start-0 bg-surface">{t('gradeColumn')}</th>
                  {subjects.map(s => (
                    <th key={s.id} scope="col" className="px-2 py-2 text-center text-label text-fg-2 whitespace-nowrap" title={s.name}>{s.code}</th>
                  ))}
                  <th scope="col" className="px-3 py-2 text-center text-label text-fg-2">{t('weeklyTotal')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {stageGrades.map(grade => {
                  const total = subjects.reduce((n, s) => n + (sessions.get(`${grade.id}:${s.id}`) ?? 0), 0)
                  return (
                    <tr key={grade.id}>
                      <th scope="row" className="px-3 py-2 text-start text-fg font-medium whitespace-nowrap sticky start-0 bg-surface">{grade.name}</th>
                      {subjects.map(s => {
                        const key = `${grade.id}:${s.id}`
                        const saved = sessions.get(key)
                        return (
                          <td key={s.id} className="px-1 py-1 text-center">
                            <input
                              type="number" min={0} max={TIMETABLE_LIMITS.weeklySessionsMax} inputMode="numeric"
                              aria-label={t('sessionsFor', { subject: s.name, grade: grade.name })}
                              className={cn('w-14 px-2 py-1 rounded-control border text-center text-body-sm eq-focus',
                                saved ? 'bg-accent-subtle border-accent text-fg' : 'bg-surface border-line text-fg-3')}
                              value={drafts[key] ?? (saved ? String(saved) : '')}
                              placeholder="—"
                              onChange={e => setDrafts(d => ({ ...d, [key]: e.target.value }))}
                              onBlur={() => void saveCell(grade.id, s.id)}
                              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                            />
                          </td>
                        )
                      })}
                      <td className="px-3 py-2 text-center text-fg-2 tabular-nums">{total}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {form && <SubjectForm subject={form.subject} onClose={() => setForm(null)} onSaved={() => { setForm(null); void onChange(async () => undefined) }} />}
    </div>
  )
}
