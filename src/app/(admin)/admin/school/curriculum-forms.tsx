'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from '@/components/ui/toast'
import { SECTION_SHIFTS, type SectionShift } from '@/lib/school-structure'
import {
  PERIOD_KINDS, PERIOD_NAME_MAX, SUBJECT_CODE_MAX, SUBJECT_COLOURS, SUBJECT_NAME_MAX, hhmm,
  type PeriodKind, type SchoolPeriod, type SchoolSubject, type SubjectColour,
} from '@/lib/school-timetable'
import { Choice, Shell, Text } from './school-forms'
import { sendSchool } from './school-ui'

// The two forms of the subjects and bell-schedule tabs (same modal shell as
// the structure forms). A save calls /api/school/subjects or /api/school/periods.

function useSave(url: string, onSaved: () => void) {
  const t = useTranslations('admin.schoolTimetable')
  const [saving, setSaving] = useState(false)
  const save = async (method: 'POST' | 'PATCH', body: Record<string, unknown>) => {
    setSaving(true)
    try {
      await sendSchool(url, method, body)
      onSaved()
    } catch (e) {
      toast((e as Error).message || t('requestFailed'), 'error')
    } finally {
      setSaving(false)
    }
  }
  return { saving, save }
}

export function SubjectForm({ subject, onClose, onSaved }: { subject?: SchoolSubject; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations('admin.schoolTimetable')
  const { saving, save } = useSave('/api/school/subjects', onSaved)
  const [name, setName] = useState(subject?.name ?? '')
  const [code, setCode] = useState(subject?.code ?? '')
  const [colour, setColour] = useState<SubjectColour | ''>(subject?.colour ?? '')
  return (
    <Shell title={t(subject ? 'editSubject' : 'addSubject')} saving={saving} onClose={onClose}
      onSubmit={() => save(subject ? 'PATCH' : 'POST', {
        kind: 'subject', ...(subject ? { id: subject.id } : {}), name, code, colour: colour || null,
      })}>
      <Text label={t('fields.subjectName')} value={name} onChange={setName} max={SUBJECT_NAME_MAX} required placeholder={t('fields.subjectNameHint')} />
      <div className="grid grid-cols-2 gap-3">
        <Text label={t('fields.subjectCode')} value={code} onChange={setCode} max={SUBJECT_CODE_MAX} required placeholder={t('fields.subjectCodeHint')} />
        <Choice label={t('fields.colour')} value={colour} onChange={setColour} none={t('fields.colourNone')}
          options={SUBJECT_COLOURS.map(c => ({ value: c, label: t(`colours.${c}`) }))} />
      </div>
    </Shell>
  )
}

export function PeriodForm({ period, shift, onClose, onSaved }: {
  period?: SchoolPeriod
  /** The bell schedule the new period joins (null = every shift). */
  shift: SectionShift | null
  onClose: () => void
  onSaved: () => void
}) {
  const t = useTranslations('admin.schoolTimetable')
  const { saving, save } = useSave('/api/school/periods', onSaved)
  const [kind, setKind] = useState<PeriodKind | ''>(period?.kind ?? 'lesson')
  const [name, setName] = useState(period?.name ?? '')
  const [periodShift, setPeriodShift] = useState<SectionShift | ''>(period ? period.shift ?? '' : shift ?? '')
  const [starts, setStarts] = useState(period ? hhmm(period.starts_at) : '')
  const [ends, setEnds] = useState(period ? hhmm(period.ends_at) : '')
  return (
    <Shell title={t(period ? 'editPeriod' : 'addPeriod')} saving={saving} onClose={onClose}
      onSubmit={() => save(period ? 'PATCH' : 'POST', {
        ...(period ? { id: period.id } : {}), period_kind: kind || 'lesson', name: name.trim() || null,
        shift: periodShift || null, starts_at: starts, ends_at: ends,
      })}>
      <div className="grid grid-cols-2 gap-3">
        <Choice label={t('fields.periodKind')} value={kind} onChange={setKind}
          options={PERIOD_KINDS.map(k => ({ value: k, label: t(`periodKinds.${k}`) }))} />
        <Choice label={t('fields.periodShift')} value={periodShift} onChange={setPeriodShift} none={t('shiftAll')}
          options={SECTION_SHIFTS.map(k => ({ value: k, label: t(`shifts.${k}`) }))} />
      </div>
      <Text label={t('fields.periodName')} value={name} onChange={setName} max={PERIOD_NAME_MAX} placeholder={t('fields.periodNameHint')} />
      <div className="grid grid-cols-2 gap-3">
        <Text label={t('fields.starts')} type="time" value={starts} onChange={setStarts} required />
        <Text label={t('fields.ends')} type="time" value={ends} onChange={setEnds} required min={starts || undefined} />
      </div>
    </Shell>
  )
}
