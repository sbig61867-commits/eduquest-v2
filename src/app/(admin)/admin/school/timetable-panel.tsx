'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AlertTriangle, CalendarDays, UserRound, X } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { TeacherPicker } from '@/components/center/teacher-picker'
import { DAY_INDEXES } from '@/components/schedules/types'
import { cn } from '@/lib/utils'
import type { SchoolGrade, SchoolSection, SchoolStage } from '@/lib/school-structure'
import {
  DEFAULT_SCHOOL_DAYS, hhmm, lessonNumbers, periodsForShift, teacherClash, weeklyCounts, weeklyStatus,
  type SchoolCurriculum, type SchoolPeriod, type SchoolSubject, type SectionTimetable, type TimetableCell,
} from '@/lib/school-timetable'
import { fieldClass, labelClass, sendSchool, subjectTone, tag } from './school-ui'

// الجدول: one section's weekly timetable, days × periods of its bell schedule.
// Click a cell to choose a subject of the section's grade (or to clear it);
// the subject's teacher in this section comes with it. A teacher already busy
// in another section at that time is shown on the option and refused by the
// database. Each subject shows its weekly count against the grade's target.

const URL_ = '/api/school/timetable'

export function TimetablePanel({ stages, grades, sections, curriculum, canSchedule }: {
  stages: SchoolStage[]
  grades: SchoolGrade[]
  sections: SchoolSection[]
  curriculum: SchoolCurriculum
  canSchedule: boolean
}) {
  const t = useTranslations('admin.schoolTimetable')
  const tc = useTranslations('common')
  const active = sections.filter(s => s.is_active)
  const [sectionId, setSectionId] = useState(active[0]?.id ?? '')
  const [data, setData] = useState<SectionTimetable | null>(null)
  const [allDays, setAllDays] = useState(false)
  const [picker, setPicker] = useState<{ day: number; period: SchoolPeriod } | null>(null)
  const [teacherFor, setTeacherFor] = useState<SchoolSubject | null>(null)
  const [busyWrite, setBusyWrite] = useState(false)

  // One read per section (and after every write); a newer read supersedes an older one still in flight.
  const seq = useRef(0)
  const [reloads, setReloads] = useState(0)
  useEffect(() => {
    if (!canSchedule || !sectionId) return
    const mine = ++seq.current
    sendSchool<SectionTimetable>(`${URL_}?section_id=${encodeURIComponent(sectionId)}`, 'GET').then(
      next => { if (mine === seq.current) setData(next) },
      (e: Error) => { if (mine === seq.current) toast(e.message || t('requestFailed'), 'error') },
    )
  }, [sectionId, canSchedule, t, reloads])

  async function write(method: 'POST' | 'PATCH' | 'DELETE', body: Record<string, unknown>) {
    setBusyWrite(true)
    try {
      await sendSchool(URL_, method, body)
      setReloads(n => n + 1)
      return true
    } catch (e) {
      toast((e as Error).message || t('requestFailed'), 'error')
      return false
    } finally {
      setBusyWrite(false)
    }
  }

  const subjectsById = useMemo(() => new Map(curriculum.subjects.map(s => [s.id, s])), [curriculum.subjects])
  const section = data?.section ?? null
  const gradeSubjects = useMemo(() => !section ? [] : curriculum.gradeSubjects
    .filter(l => l.grade_id === section.grade_id && subjectsById.has(l.subject_id))
    .map(l => ({ subject: subjectsById.get(l.subject_id)!, target: l.weekly_sessions }))
    .sort((a, b) => a.subject.sort_order - b.subject.sort_order || a.subject.name.localeCompare(b.subject.name)),
  [section, curriculum.gradeSubjects, subjectsById])

  const bell = useMemo(() => periodsForShift(curriculum.periods, section?.shift ?? null), [curriculum.periods, section])
  const numbers = useMemo(() => lessonNumbers(bell), [bell])
  const cells = useMemo(() => data?.cells ?? [], [data])
  const cellAt = useMemo(() => new Map(cells.map(c => [`${c.day}:${c.period_id}`, c])), [cells])
  // rows: the section's bell, plus any period a cell still uses that is outside it (another shift, archived)
  const rows = useMemo(() => {
    const ids = new Set(bell.map(p => p.id))
    const byId = new Map(curriculum.periods.map(p => [p.id, p]))
    const extra = [...new Set(cells.map(c => c.period_id))].filter(id => !ids.has(id))
      .map(id => byId.get(id) ?? { id, shift: null, kind: 'lesson' as const, name: null, starts_at: '', ends_at: '' })
    return [...bell, ...extra].sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  }, [bell, cells, curriculum.periods])
  const outside = useMemo(() => new Set(rows.filter(p => !bell.some(b => b.id === p.id)).map(p => p.id)), [rows, bell])
  const days = useMemo(() => allDays
    ? [...DAY_INDEXES]
    : [...new Set<number>([...DEFAULT_SCHOOL_DAYS, ...cells.map(c => c.day)])].sort((a, b) => a - b), [allDays, cells])
  const counts = useMemo(() => weeklyCounts(cells), [cells])
  const teacherOf = useMemo(() => new Map((data?.teachers ?? []).map(x => [x.subject_id, x])), [data])

  if (!canSchedule) {
    return (
      <div className="bg-surface border border-line rounded-overlay p-6 text-center">
        <p className="text-fg-2 text-body-sm">{t('needSchedulesCapability')}</p>
      </div>
    )
  }
  if (active.length === 0) {
    return (
      <div className="bg-surface border border-line rounded-overlay p-6 text-center">
        <CalendarDays className="w-8 h-8 text-fg-3 mx-auto mb-3" aria-hidden="true" />
        <p className="text-fg-2 text-body-sm">{t('noSectionsForTimetable')}</p>
      </div>
    )
  }

  const gradeName = new Map(grades.map(g => [g.id, g.name]))
  const orderedGrades = stages.flatMap(s => grades.filter(g => g.stage_id === s.id))
  const clashOf = (cell: TimetableCell, period: SchoolPeriod) =>
    section ? teacherClash(data?.busy ?? [], cell.teacher_id, cell.day, period, section.id) : null
  const periodLabel = (p: SchoolPeriod) => p.kind === 'break'
    ? (p.name ?? t('periodKinds.break'))
    : (p.name ?? t('lessonNo', { no: numbers.get(p.id) ?? 0 }))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="block min-w-60">
          <span className={labelClass}>{t('section')}</span>
          <select className={fieldClass} value={sectionId} onChange={e => setSectionId(e.target.value)}>
            {orderedGrades.map(g => {
              const list = active.filter(s => s.grade_id === g.id)
              return list.length === 0 ? null : (
                <optgroup key={g.id} label={gradeName.get(g.id) ?? ''}>
                  {list.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </optgroup>
              )
            })}
          </select>
        </label>
        {data && (
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-body-sm text-fg-2">
              <input type="checkbox" checked={allDays} onChange={e => setAllDays(e.target.checked)} />
              {t('showAllDays')}
            </label>
            {data.schedule?.is_published ? tag(t('published'), 'success') : tag(t('draft'))}
            <Button variant="secondary" size="sm" disabled={busyWrite}
              onClick={() => write('PATCH', { section_id: sectionId, is_published: !data.schedule?.is_published })}>
              {data.schedule?.is_published ? t('unpublish') : t('publish')}
            </Button>
          </div>
        )}
      </div>

      {!data ? null : bell.length === 0 ? (
        <div className="bg-surface border border-line rounded-overlay p-6 text-center">
          <p className="text-fg-2 text-body-sm">{t('noBell')}</p>
        </div>
      ) : (
        <>
          <section className="bg-surface border border-line rounded-overlay">
            <header className="p-4 border-b border-line">
              <h3 className="text-h3 text-fg">{t('subjectsOfSection', { name: data.section.name })}</h3>
              <p className="text-meta text-fg-3 mt-0.5">{t('subjectsOfSectionHint')}</p>
            </header>
            {gradeSubjects.length === 0 ? (
              <p className="p-4 text-fg-3 text-body-sm">{t('noGradeSubjects')}</p>
            ) : (
              <ul className="divide-y divide-line">
                {gradeSubjects.map(({ subject, target }) => {
                  const count = counts.get(subject.id) ?? 0
                  const status = weeklyStatus(count, target)
                  const teacher = teacherOf.get(subject.id)
                  return (
                    <li key={subject.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                      <div className="min-w-0 flex flex-wrap items-center gap-2">
                        <span className={cn('inline-flex items-center px-2 py-0.5 rounded-control border text-label', subjectTone(subject.colour))}>{subject.code}</span>
                        <span className="text-fg text-body-sm font-medium">{subject.name}</span>
                        <span className={cn('text-meta tabular-nums', status === 'over' ? 'text-warning' : status === 'met' ? 'text-success' : 'text-fg-3')}>
                          {t('weeklyCount', { count, target })}
                        </span>
                        {status === 'over' && <span className="text-meta text-warning">{t('overTarget')}</span>}
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => setTeacherFor(subject)}>
                        <UserRound className="w-4 h-4" /> {teacher?.teacher_name ?? t('noTeacher')}
                      </Button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {outside.size > 0 && (
            <p className="flex items-center gap-2 text-body-sm text-warning">
              <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" /> {t('outsideBell')}
            </p>
          )}

          <div className="overflow-x-auto bg-surface border border-line rounded-overlay">
            <table className="min-w-full text-body-sm">
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="px-3 py-2 text-start text-label text-fg-2 whitespace-nowrap">{t('periodColumn')}</th>
                  {days.map(d => <th key={d} scope="col" className="px-2 py-2 text-center text-label text-fg-2 whitespace-nowrap">{tc(`days.${d}`)}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map(p => (
                  <tr key={p.id} className={cn(p.kind === 'break' && 'bg-elevated')}>
                    <th scope="row" className="px-3 py-2 text-start align-top whitespace-nowrap">
                      <span className={cn('block font-medium', outside.has(p.id) ? 'text-warning' : 'text-fg')}>{periodLabel(p)}</span>
                      {p.starts_at && <span className="block text-meta text-fg-3 tabular-nums">{t('timeRange', { start: hhmm(p.starts_at), end: hhmm(p.ends_at) })}</span>}
                    </th>
                    {p.kind === 'break' ? (
                      <td colSpan={days.length} className="px-2 py-2 text-center text-meta text-fg-3">{periodLabel(p)}</td>
                    ) : days.map(d => {
                      const cell = cellAt.get(`${d}:${p.id}`)
                      const subject = cell ? subjectsById.get(cell.subject_id) : undefined
                      const clash = cell ? clashOf(cell, p) : null
                      const teacherName = cell ? teacherOf.get(cell.subject_id)?.teacher_name : null
                      return (
                        <td key={d} className="px-1 py-1 align-top">
                          <button type="button" disabled={busyWrite}
                            aria-label={t('cellLabel', { day: tc(`days.${d}`), period: periodLabel(p) })}
                            onClick={() => setPicker({ day: d, period: p })}
                            className={cn('eq-focus w-full min-w-28 min-h-14 px-2 py-1.5 rounded-control border text-start transition-colors',
                              cell ? subjectTone(subject?.colour) : 'border-dashed border-line text-fg-3 hover:bg-elevated',
                              clash && 'border-warning')}>
                            {cell ? (
                              <>
                                <span className="block text-body-sm font-medium leading-tight">{subject?.name ?? t('unknownSubject')}</span>
                                <span className="block text-meta mt-0.5 truncate">{teacherName ?? t('noTeacher')}</span>
                                {clash && <span className="block text-meta text-warning mt-0.5">{t('busyIn', { section: clash.section_name })}</span>}
                              </>
                            ) : (
                              <span className="block text-center text-meta">{t('emptyCell')}</span>
                            )}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {picker && data && (
        <Modal open onClose={() => setPicker(null)} title={t('pickTitle', { day: tc(`days.${picker.day}`), period: periodLabel(picker.period) })}>
          <div className="space-y-3">
            {gradeSubjects.length === 0 ? (
              <p className="text-fg-3 text-body-sm">{t('noGradeSubjects')}</p>
            ) : (
              <ul className="space-y-2">
                {gradeSubjects.map(({ subject, target }) => {
                  const current = cellAt.get(`${picker.day}:${picker.period.id}`)
                  const teacher = teacherOf.get(subject.id)
                  const clash = teacherClash(data.busy, teacher?.teacher_id, picker.day, picker.period, data.section.id)
                  const count = counts.get(subject.id) ?? 0
                  const chosen = current?.subject_id === subject.id
                  const after = chosen ? count : count + 1
                  return (
                    <li key={subject.id}>
                      <button type="button" disabled={!!clash || busyWrite || chosen} aria-pressed={chosen}
                        onClick={async () => {
                          if (await write('POST', { kind: 'cell', section_id: data.section.id, day: picker.day, period_id: picker.period.id, subject_id: subject.id })) setPicker(null)
                        }}
                        className={cn('eq-focus w-full flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-control border text-start',
                          chosen ? 'border-accent bg-accent-subtle' : 'border-line bg-surface hover:bg-elevated',
                          'disabled:opacity-60 disabled:cursor-not-allowed')}>
                        <span className="min-w-0 flex items-center gap-2">
                          <span className={cn('inline-flex px-2 py-0.5 rounded-control border text-label', subjectTone(subject.colour))}>{subject.code}</span>
                          <span className="text-fg text-body-sm font-medium truncate">{subject.name}</span>
                        </span>
                        <span className="text-meta text-fg-3 flex flex-wrap gap-x-3">
                          <span>{teacher?.teacher_name ?? t('noTeacher')}</span>
                          <span className={cn('tabular-nums', after > target && 'text-warning')}>{t('weeklyCount', { count, target })}</span>
                          {clash && <span className="text-warning">{t('busyIn', { section: clash.section_name })}</span>}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            {cellAt.has(`${picker.day}:${picker.period.id}`) && (
              <Button variant="secondary" className="w-full" disabled={busyWrite}
                onClick={async () => {
                  if (await write('DELETE', { kind: 'cell', section_id: data.section.id, day: picker.day, period_id: picker.period.id })) setPicker(null)
                }}>
                <X className="w-4 h-4" /> {t('clearCell')}
              </Button>
            )}
          </div>
        </Modal>
      )}

      {teacherFor && data && (
        <Modal open onClose={() => setTeacherFor(null)} title={t('teacherTitle', { subject: teacherFor.name, section: data.section.name })}>
          <div className="space-y-3">
            <p className="text-meta text-fg-3">{t('teacherHint')}</p>
            {teacherOf.get(teacherFor.id) && (
              <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-control border border-line bg-elevated">
                <span className="text-fg text-body-sm truncate">{teacherOf.get(teacherFor.id)?.teacher_name}</span>
                <Button variant="ghost" size="sm" disabled={busyWrite}
                  onClick={async () => {
                    if (await write('POST', { kind: 'teacher', section_id: data.section.id, subject_id: teacherFor.id, teacher_id: null })) setTeacherFor(null)
                  }}>
                  <X className="w-4 h-4" /> {t('removeTeacher')}
                </Button>
              </div>
            )}
            <TeacherPicker scope="school" selectedId={teacherOf.get(teacherFor.id)?.teacher_id ?? null}
              onPick={async teacher => {
                if (await write('POST', { kind: 'teacher', section_id: data.section.id, subject_id: teacherFor.id, teacher_id: teacher.id })) setTeacherFor(null)
              }} />
          </div>
        </Modal>
      )}
    </div>
  )
}
