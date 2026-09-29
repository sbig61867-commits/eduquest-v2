'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { FourPartNameFields } from '@/components/shared/four-part-name-fields'
import { checkNameParts, EMPTY_NAME_PARTS, type NameParts } from '@/lib/person-name'

// Staff correction of a student's four-part name (a student cannot change it
// after registering). Staff only ever see first + family name, never the middle
// names, so the four fields start empty and are filled from the institution's
// records; the server re-checks the parts in /api/admin/student-name.

export interface NamedStudent { id: string; full_name: string }

interface Props {
  student: NamedStudent | null
  onClose: () => void
  /** The short name staff now see, and whether a four-part name is on file. */
  onSaved: (id: string, fullName: string, nameComplete: boolean) => void
}

export function StudentNameEditor({ student, onClose, onSaved }: Props) {
  const t = useTranslations('common.studentName')
  return (
    <Modal open={!!student} onClose={onClose} title={t('correctTitle')}>
      {/* Keyed so each student opens with their own name, not the last one's. */}
      {student && <EditorBody key={student.id} student={student} onClose={onClose} onSaved={onSaved} />}
    </Modal>
  )
}

function EditorBody({ student, onClose, onSaved }: Props & { student: NamedStudent }) {
  const t = useTranslations('common.studentName')
  const tActions = useTranslations('common.actions')
  const [parts, setParts] = useState<NameParts>(EMPTY_NAME_PARTS)
  const [showErrors, setShowErrors] = useState(false)
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!checkNameParts(parts).ok) { setShowErrors(true); return }
    setBusy(true)
    const res = await fetch('/api/admin/student-name', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: student.id, nameParts: parts }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) return toast.error(data.error ?? t('failed'))
    toast.success(t('saved'))
    onSaved(student.id, typeof data.full_name === 'string' ? data.full_name : student.full_name, data.name_complete === true)
    onClose()
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">{t('correctFor', { name: student.full_name })}</p>
      <FourPartNameFields
        idPrefix="correct-name"
        value={parts}
        onChange={setParts}
        showErrors={showErrors}
        hint={t('correctHint')}
      />
      <div className="flex gap-2 justify-end pt-2">
        <Button variant="ghost" onClick={onClose}>{tActions('cancel')}</Button>
        <Button loading={busy} onClick={save}>{tActions('save')}</Button>
      </div>
    </div>
  )
}
