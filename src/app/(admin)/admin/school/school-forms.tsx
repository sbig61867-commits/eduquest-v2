'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { X } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { TeacherPicker } from '@/components/center/teacher-picker'
import {
  CAPACITY_MAX, CODE_MAX, GRADE_TRACKS, NAME_MAX, SCHOOL_LIMITS, SECTION_LABEL_MAX, SECTION_SHIFTS, STAGE_KINDS,
  TERM_NAME_MAX, YEAR_NAME_MAX,
  type SchoolGrade, type SchoolSection, type SchoolStage, type SchoolTerm, type SchoolYear,
} from '@/lib/school-structure'
import { fieldClass, labelClass, sendSchool } from './school-ui'

export type FormState =
  | { kind: 'stage'; stage?: SchoolStage }
  | { kind: 'grade'; stageId: string; grade?: SchoolGrade }
  | { kind: 'section'; gradeId: string; yearId: string; section?: SchoolSection }
  | { kind: 'year'; year?: SchoolYear }
  | { kind: 'term'; yearId: string; term?: SchoolTerm; nextNo?: number }

interface FormProps<S> { state: S; onClose: () => void; onSaved: () => void }
type StageProps = FormProps<Extract<FormState, { kind: 'stage' }>>
type GradeProps = FormProps<Extract<FormState, { kind: 'grade' }>>
type SectionProps = FormProps<Extract<FormState, { kind: 'section' }>>
type YearProps = FormProps<Extract<FormState, { kind: 'year' }>>
type TermProps = FormProps<Extract<FormState, { kind: 'term' }>>

const STRUCTURE_URL = '/api/school/structure'

export function Shell({ title, saving, onClose, onSubmit, children }: {
  title: string; saving: boolean; onClose: () => void; onSubmit: () => void; children: React.ReactNode
}) {
  const t = useTranslations('admin.schoolClient')
  return (
    <Modal open onClose={onClose} title={title}>
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); onSubmit() }}>
        {children}
        <div className="flex gap-3 pt-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>{t('cancel')}</Button>
          <Button type="submit" loading={saving} className="flex-1">{t('save')}</Button>
        </div>
      </form>
    </Modal>
  )
}

export function Text({ label, value, onChange, max, required, placeholder, type = 'text', min }: {
  label: string; value: string; onChange: (v: string) => void; max?: number; required?: boolean; placeholder?: string; type?: string; min?: string
}) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <input className={fieldClass} type={type} value={value} maxLength={max} required={required} placeholder={placeholder} min={min}
        onChange={e => onChange(e.target.value)} />
    </label>
  )
}

export function Choice<T extends string>({ label, value, options, onChange, none }: {
  label: string; value: T | ''; options: readonly { value: T; label: string }[]; onChange: (v: T | '') => void; none?: string
}) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <select className={fieldClass} value={value} onChange={e => onChange(e.target.value as T | '')}>
        {none !== undefined && <option value="">{none}</option>}
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}

function useSave(onSaved: () => void) {
  const t = useTranslations('admin.schoolClient')
  const [saving, setSaving] = useState(false)
  const save = async (method: 'POST' | 'PATCH', body: Record<string, unknown>) => {
    setSaving(true)
    try {
      await sendSchool(STRUCTURE_URL, method, body)
      onSaved()
    } catch (e) {
      toast((e as Error).message || t('requestFailed'), 'error')
    } finally {
      setSaving(false)
    }
  }
  return { saving, save }
}

export function StageForm({ state, onClose, onSaved }: StageProps) {
  const t = useTranslations('admin.schoolClient')
  const { saving, save } = useSave(onSaved)
  const [kind, setKind] = useState<(typeof STAGE_KINDS)[number] | ''>(state.stage?.kind ?? 'basic')
  const [name, setName] = useState(state.stage?.name ?? '')
  const [code, setCode] = useState(state.stage?.code ?? '')
  return (
    <Shell title={t(state.stage ? 'editStage' : 'addStage')} saving={saving} onClose={onClose}
      onSubmit={() => save(state.stage ? 'PATCH' : 'POST', {
        kind: 'stage', ...(state.stage ? { id: state.stage.id } : {}), name, code, stage_kind: kind,
      })}>
      <Choice label={t('fields.kind')} value={kind} onChange={setKind}
        options={STAGE_KINDS.map(k => ({ value: k, label: t(`kinds.${k}`) }))} />
      <Text label={t('fields.name')} value={name} onChange={setName} max={NAME_MAX} required />
      <Text label={t('fields.code')} value={code} onChange={setCode} max={CODE_MAX} />
    </Shell>
  )
}

export function GradeForm({ state, onClose, onSaved }: GradeProps) {
  const t = useTranslations('admin.schoolClient')
  const { saving, save } = useSave(onSaved)
  const [name, setName] = useState(state.grade?.name ?? '')
  const [code, setCode] = useState(state.grade?.code ?? '')
  const [track, setTrack] = useState<(typeof GRADE_TRACKS)[number] | ''>(state.grade?.track ?? '')
  return (
    <Shell title={t(state.grade ? 'editGrade' : 'addGrade')} saving={saving} onClose={onClose}
      onSubmit={() => save(state.grade ? 'PATCH' : 'POST', {
        kind: 'grade', ...(state.grade ? { id: state.grade.id } : { stage_id: state.stageId }), name, code, track: track || null,
      })}>
      <Text label={t('fields.name')} value={name} onChange={setName} max={NAME_MAX} required placeholder={t('fields.gradeHint')} />
      <Choice label={t('fields.track')} value={track} onChange={setTrack} none={t('fields.trackNone')}
        options={GRADE_TRACKS.map(k => ({ value: k, label: t(`tracks.${k}`) }))} />
      <Text label={t('fields.code')} value={code} onChange={setCode} max={CODE_MAX} />
    </Shell>
  )
}

export function SectionForm({ state, onClose, onSaved }: SectionProps) {
  const t = useTranslations('admin.schoolClient')
  const { saving, save } = useSave(onSaved)
  const s = state.section
  const [label, setLabel] = useState(s?.label ?? '')
  const [shift, setShift] = useState<(typeof SECTION_SHIFTS)[number] | ''>(s?.shift ?? '')
  const [capacity, setCapacity] = useState(s?.capacity ? String(s.capacity) : '')
  const [teacher, setTeacher] = useState<{ id: string; full_name: string } | null>(
    s?.teacher_id ? { id: s.teacher_id, full_name: s.teacher_name ?? '' } : null)
  const capacityValue = capacity.trim() === '' ? null : Number(capacity)
  return (
    <Shell title={t(s ? 'editSection' : 'addSection')} saving={saving} onClose={onClose}
      onSubmit={() => save(s ? 'PATCH' : 'POST', {
        kind: 'section', ...(s ? { id: s.id } : { grade_id: state.gradeId, year_id: state.yearId }),
        label, shift: shift || null, capacity: capacityValue, teacher_id: teacher?.id ?? null,
      })}>
      <Text label={t('fields.label')} value={label} onChange={setLabel} max={SECTION_LABEL_MAX} required placeholder={t('fields.labelHint')} />
      <div className="grid grid-cols-2 gap-3">
        <Choice label={t('fields.shift')} value={shift} onChange={setShift} none={t('fields.shiftNone')}
          options={SECTION_SHIFTS.map(k => ({ value: k, label: t(`shifts.${k}`) }))} />
        <Text label={t('fields.capacity')} value={capacity} onChange={setCapacity} type="number" min="1" />
      </div>
      <div>
        <span className={labelClass}>{t('fields.homeroom')}</span>
        {teacher ? (
          <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-control border border-line bg-elevated">
            <span className="text-fg text-body-sm truncate">{teacher.full_name}</span>
            <button type="button" className="eq-focus p-1 rounded-control text-fg-3 hover:text-fg" aria-label={t('fields.clearHomeroom')}
              onClick={() => setTeacher(null)}><X className="w-4 h-4" /></button>
          </div>
        ) : (
          <TeacherPicker scope="school" onPick={setTeacher} />
        )}
      </div>
      <p className="text-meta text-fg-3">{t('fields.capacityHint', { max: CAPACITY_MAX })}</p>
    </Shell>
  )
}

export function YearForm({ state, onClose, onSaved }: YearProps) {
  const t = useTranslations('admin.schoolClient')
  const { saving, save } = useSave(onSaved)
  const y = state.year
  const [name, setName] = useState(y?.name ?? '')
  const [starts, setStarts] = useState(y?.starts_on ?? '')
  const [ends, setEnds] = useState(y?.ends_on ?? '')
  const [active, setActive] = useState(y?.is_active ?? false)
  return (
    <Shell title={t(y ? 'editYear' : 'addYear')} saving={saving} onClose={onClose}
      onSubmit={() => save(y ? 'PATCH' : 'POST', {
        kind: 'year', ...(y ? { id: y.id } : {}), name, starts_on: starts, ends_on: ends, is_active: active,
      })}>
      <Text label={t('fields.yearName')} value={name} onChange={setName} max={YEAR_NAME_MAX} required placeholder={t('fields.yearNameHint')} />
      <div className="grid grid-cols-2 gap-3">
        <Text label={t('fields.starts')} type="date" value={starts} onChange={setStarts} required />
        <Text label={t('fields.ends')} type="date" value={ends} onChange={setEnds} required min={starts || undefined} />
      </div>
      <label className="flex items-center gap-2 text-body-sm text-fg-2">
        <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
        {t('fields.setActive')}
      </label>
    </Shell>
  )
}

export function TermForm({ state, onClose, onSaved }: TermProps) {
  const t = useTranslations('admin.schoolClient')
  const { saving, save } = useSave(onSaved)
  const term = state.term
  const [no, setNo] = useState(String(term?.term_no ?? state.nextNo ?? 1))
  const [name, setName] = useState(term?.name ?? '')
  const [starts, setStarts] = useState(term?.starts_on ?? '')
  const [ends, setEnds] = useState(term?.ends_on ?? '')
  const numbers = Array.from({ length: SCHOOL_LIMITS.termsPerYear }, (_, i) => String(i + 1))
  return (
    <Shell title={t(term ? 'editTerm' : 'addTerm')} saving={saving} onClose={onClose}
      onSubmit={() => save(term ? 'PATCH' : 'POST', {
        kind: 'term', ...(term ? { id: term.id } : { year_id: state.yearId }), term_no: Number(no), name, starts_on: starts, ends_on: ends,
      })}>
      <div className="grid grid-cols-3 gap-3">
        <Choice label={t('fields.termNo')} value={no} onChange={v => setNo(v || '1')}
          options={numbers.map(n => ({ value: n, label: n }))} />
        <div className="col-span-2">
          <Text label={t('fields.termName')} value={name} onChange={setName} max={TERM_NAME_MAX} required placeholder={t('fields.termNameHint')} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Text label={t('fields.starts')} type="date" value={starts} onChange={setStarts} required />
        <Text label={t('fields.ends')} type="date" value={ends} onChange={setEnds} required min={starts || undefined} />
      </div>
    </Shell>
  )
}
