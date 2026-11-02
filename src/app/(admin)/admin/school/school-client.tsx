'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Plus, Pencil, Archive, ArchiveRestore, ChevronUp, ChevronDown, School } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { confirmDialog } from '@/lib/confirm-dialog'
import { cn } from '@/lib/utils'
import { moveInOrder, type SchoolGrade, type SchoolSection, type SchoolStage, type SchoolTerm, type SchoolYear } from '@/lib/school-structure'
import { GradeForm, SectionForm, StageForm, type FormState } from './school-forms'
import { YearsPanel } from './years-panel'
import { PlacementPanel } from './placement-panel'
import { SubjectsPanel } from './subjects-panel'
import { PeriodsPanel } from './periods-panel'
import { TimetablePanel } from './timetable-panel'
import type { SchoolCurriculum } from '@/lib/school-timetable'
import { sendSchool, tag } from './school-ui'

interface Props {
  stages: SchoolStage[]
  grades: SchoolGrade[]
  years: SchoolYear[]
  terms: SchoolTerm[]
  yearId: string | null
  sections: SchoolSection[]
  /** Subjects, grade links and bell schedule; null until migration 0014 is applied. */
  curriculum: SchoolCurriculum | null
  /** The caller holds manage_schedules (the timetable tab's writes need it). */
  canSchedule: boolean
}

const TABS = ['structure', 'years', 'placement', 'subjects', 'periods', 'timetable'] as const
type Tab = (typeof TABS)[number]

export function SchoolClient({ stages, grades, years, terms, yearId, sections, curriculum, canSchedule }: Props) {
  const t = useTranslations('admin.schoolClient')
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('structure')
  const [form, setForm] = useState<FormState | null>(null)

  const gradesOf = (stageId: string) => grades.filter(g => g.stage_id === stageId)
  const sectionsOf = (gradeId: string) => sections.filter(s => s.grade_id === gradeId)
  const year = years.find(y => y.id === yearId) ?? null

  async function act(work: () => Promise<unknown>) {
    try {
      await work()
      router.refresh()
      return true
    } catch (e) {
      toast((e as Error).message || t('requestFailed'), 'error')
      return false
    }
  }

  const reorder = (kind: 'stage' | 'grade' | 'section', ids: string[], id: string, step: -1 | 1) => {
    const order = moveInOrder(ids, id, step)
    if (order) void act(() => sendSchool('/api/school/structure', 'PATCH', { kind, order }))
  }

  async function archive(kind: 'stage' | 'grade' | 'section', id: string, name: string) {
    const message = kind === 'stage' ? t('archiveStageConfirm', { name })
      : kind === 'grade' ? t('archiveGradeConfirm', { name }) : t('archiveSectionConfirm', { name })
    if (!(await confirmDialog(message))) return
    await act(() => sendSchool('/api/school/structure', 'DELETE', { kind, id }))
  }

  const tabClass = (active: boolean) => cn(
    'eq-focus px-4 py-2 rounded-control text-body-sm font-medium transition-colors',
    active ? 'bg-accent text-accent-fg' : 'text-fg-2 hover:text-fg hover:bg-elevated',
  )
  const iconButton = 'eq-focus p-1.5 rounded-control text-fg-3 hover:text-fg hover:bg-elevated disabled:opacity-40 disabled:pointer-events-none'

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-h1 text-fg">{t('title')}</h2>
          <p className="text-fg-3 text-body-sm mt-1">{t('subtitle')}</p>
        </div>
        {tab === 'structure' && (
          <Button onClick={() => setForm({ kind: 'stage' })}><Plus className="w-4 h-4" /> {t('addStage')}</Button>
        )}
      </div>

      <div className="flex flex-wrap gap-2" role="tablist">
        {TABS.map(k => (
          <button key={k} role="tab" aria-selected={tab === k} className={tabClass(tab === k)} onClick={() => setTab(k)}>
            {t(`tabs.${k}`)}
          </button>
        ))}
      </div>

      {(tab === 'structure' || tab === 'placement' || tab === 'timetable') && years.length > 0 && (
      <label className="flex flex-wrap items-center gap-2 text-body-sm text-fg-2">
        {t('sectionsYear')}
        <select
          className="px-3 py-2 rounded-control bg-surface border border-line text-fg text-body-sm eq-focus"
          value={yearId ?? ''}
          onChange={e => router.push(`/admin/school?year=${encodeURIComponent(e.target.value)}`)}
        >
          {years.map(y => <option key={y.id} value={y.id}>{y.is_active ? t('activeYearOption', { name: y.name }) : y.name}</option>)}
        </select>
      </label>
      )}

      {tab === 'structure' && (
        <div className="space-y-4">
          {stages.length === 0 ? (
            <div className="bg-surface border border-line rounded-overlay p-6 text-center">
              <School className="w-8 h-8 text-fg-3 mx-auto mb-3" aria-hidden="true" />
              <p className="text-fg-2 text-body-sm">{t('noStages')}</p>
            </div>
          ) : stages.map((stage, si) => (
            <section key={stage.id} className="bg-surface border border-line rounded-overlay">
              <header className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-line">
                <div className="min-w-0 flex flex-wrap items-center gap-2">
                  <h3 className="text-h3 text-fg truncate">{stage.name}</h3>
                  {tag(t(`kinds.${stage.kind}`))}
                  {stage.code && <span className="text-meta text-fg-3 font-mono">{stage.code}</span>}
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setForm({ kind: 'grade', stageId: stage.id })}>
                    <Plus className="w-4 h-4" /> {t('addGrade')}
                  </Button>
                  <button className={iconButton} aria-label={t('moveUp')} disabled={si === 0}
                    onClick={() => reorder('stage', stages.map(s => s.id), stage.id, -1)}><ChevronUp className="w-4 h-4" /></button>
                  <button className={iconButton} aria-label={t('moveDown')} disabled={si === stages.length - 1}
                    onClick={() => reorder('stage', stages.map(s => s.id), stage.id, 1)}><ChevronDown className="w-4 h-4" /></button>
                  <button className={iconButton} aria-label={t('edit')} onClick={() => setForm({ kind: 'stage', stage })}><Pencil className="w-4 h-4" /></button>
                  <button className={iconButton} aria-label={t('archive')} onClick={() => archive('stage', stage.id, stage.name)}><Archive className="w-4 h-4" /></button>
                </div>
              </header>

              {gradesOf(stage.id).length === 0 ? (
                <p className="p-4 text-fg-3 text-body-sm">{t('noGrades')}</p>
              ) : (
                <ul className="divide-y divide-line">
                  {gradesOf(stage.id).map((grade, gi, list) => (
                    <li key={grade.id} className="p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0 flex flex-wrap items-center gap-2">
                          <span className="text-fg font-medium truncate">{grade.name}</span>
                          {grade.track && tag(t(`tracks.${grade.track}`))}
                          {grade.code && <span className="text-meta text-fg-3 font-mono">{grade.code}</span>}
                        </div>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="sm" disabled={!year}
                            onClick={() => year && setForm({ kind: 'section', gradeId: grade.id, yearId: year.id })}>
                            <Plus className="w-4 h-4" /> {t('addSection')}
                          </Button>
                          <button className={iconButton} aria-label={t('moveUp')} disabled={gi === 0}
                            onClick={() => reorder('grade', list.map(g => g.id), grade.id, -1)}><ChevronUp className="w-4 h-4" /></button>
                          <button className={iconButton} aria-label={t('moveDown')} disabled={gi === list.length - 1}
                            onClick={() => reorder('grade', list.map(g => g.id), grade.id, 1)}><ChevronDown className="w-4 h-4" /></button>
                          <button className={iconButton} aria-label={t('edit')} onClick={() => setForm({ kind: 'grade', stageId: stage.id, grade })}><Pencil className="w-4 h-4" /></button>
                          <button className={iconButton} aria-label={t('archive')} onClick={() => archive('grade', grade.id, grade.name)}><Archive className="w-4 h-4" /></button>
                        </div>
                      </div>

                      {!year ? (
                        <p className="text-fg-3 text-meta">{t('needYear')}</p>
                      ) : sectionsOf(grade.id).length === 0 ? (
                        <p className="text-fg-3 text-meta">{t('noSections')}</p>
                      ) : (
                        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                          {sectionsOf(grade.id).map((section, ki, secs) => (
                            <li key={section.id} className={cn('border border-line rounded-control p-3 space-y-1', !section.is_active && 'opacity-60')}>
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-fg font-medium truncate">{section.name}</span>
                                <span className="flex items-center gap-0.5 shrink-0">
                                  <button className={iconButton} aria-label={t('moveUp')} disabled={ki === 0}
                                    onClick={() => reorder('section', secs.map(s => s.id), section.id, -1)}><ChevronUp className="w-3.5 h-3.5" /></button>
                                  <button className={iconButton} aria-label={t('moveDown')} disabled={ki === secs.length - 1}
                                    onClick={() => reorder('section', secs.map(s => s.id), section.id, 1)}><ChevronDown className="w-3.5 h-3.5" /></button>
                                  <button className={iconButton} aria-label={t('edit')}
                                    onClick={() => setForm({ kind: 'section', gradeId: grade.id, yearId: year.id, section })}><Pencil className="w-3.5 h-3.5" /></button>
                                  {section.is_active ? (
                                    <button className={iconButton} aria-label={t('archive')} onClick={() => archive('section', section.id, section.name)}><Archive className="w-3.5 h-3.5" /></button>
                                  ) : (
                                    <button className={iconButton} aria-label={t('restore')}
                                      onClick={() => act(() => sendSchool('/api/school/structure', 'PATCH', { kind: 'section', id: section.id, is_active: true }))}>
                                      <ArchiveRestore className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </span>
                              </div>
                              <p className="text-meta text-fg-3 flex flex-wrap gap-x-3 gap-y-1">
                                <span>{section.capacity
                                  ? t('membersOfCapacity', { members: section.members, capacity: section.capacity })
                                  : t('studentsCount', { count: section.members })}</span>
                                {section.shift && <span>{t(`shifts.${section.shift}`)}</span>}
                                <span>{section.teacher_name ? t('homeroomOf', { name: section.teacher_name }) : t('noHomeroom')}</span>
                                {!section.is_active && <span>{t('archived')}</span>}
                              </p>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}

      {tab === 'years' && <YearsPanel years={years} terms={terms} onChange={act} />}
      {tab === 'placement' && <PlacementPanel key={yearId ?? 'none'} grades={grades} stages={stages} sections={sections} sectionsYearId={yearId} />}
      {(tab === 'subjects' || tab === 'periods' || tab === 'timetable') && !curriculum && (
        <div className="bg-surface border border-line rounded-overlay p-6 text-center">
          <p className="text-fg-2 text-body-sm">{t('timetableMigrationMissing')}</p>
        </div>
      )}
      {tab === 'subjects' && curriculum && (
        <SubjectsPanel stages={stages} grades={grades} subjects={curriculum.subjects} gradeSubjects={curriculum.gradeSubjects} onChange={act} />
      )}
      {tab === 'periods' && curriculum && <PeriodsPanel periods={curriculum.periods} onChange={act} />}
      {tab === 'timetable' && curriculum && (
        <TimetablePanel key={yearId ?? 'none'} stages={stages} grades={grades} sections={sections} curriculum={curriculum} canSchedule={canSchedule} />
      )}

      {form?.kind === 'stage' && <StageForm state={form} onClose={() => setForm(null)} onSaved={() => { setForm(null); router.refresh() }} />}
      {form?.kind === 'grade' && <GradeForm state={form} onClose={() => setForm(null)} onSaved={() => { setForm(null); router.refresh() }} />}
      {form?.kind === 'section' && <SectionForm state={form} onClose={() => setForm(null)} onSaved={() => { setForm(null); router.refresh() }} />}
    </div>
  )
}
