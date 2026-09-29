'use client'

import { useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import type { Locale } from '@/i18n/config'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/components/ui/toast'
import { formatDate } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { getTerms } from '@/lib/terminology'
import { Search, UserPlus, Mail, Power, GraduationCap, Lock, PenLine, Copy } from 'lucide-react'
import type { ScopeBlock } from '@/lib/account-scope'
import { checkNameParts, EMPTY_NAME_PARTS, type NameParts } from '@/lib/person-name'
import { FourPartNameFields } from '@/components/shared/four-part-name-fields'
import { StudentNameEditor, type NamedStudent } from '@/components/shared/student-name-editor'

export interface PersonRow {
  id: string
  full_name: string
  email: string
  is_active: boolean
  created_at: string
  /** Students only — university student vs centre-only trainee. */
  is_university_student?: boolean
  /** Set when the account is shared with / owned by the institution: only its admin may (de)activate it. */
  locked?: ScopeBlock | null
  /** Students only: a four-part name is on file (staff never see its middle names). Null = unknown. */
  name_complete?: boolean | null
}

export function PeopleClient({ role, initialPeople, canSetAffiliation = false }: {
  role: 'teacher' | 'student'
  initialPeople: PersonRow[]
  /** Holds `announce_to_university`: may classify a student as a university student. */
  canSetAffiliation?: boolean
}) {
  const t = useTranslations('staff.people')
  const locale = useLocale() as Locale
  const router = useRouter()
  const [people, setPeople] = useState(initialPeople)
  const terms = getTerms(useAuthStore(s => s.tenant?.institution_type), locale)
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'invite' | 'account' | 'byId'>('invite')
  // A student account without an email: member ID + temporary password,
  // shown once in the dialog (src/app/api/admin/create-user/route.ts).
  const tInv = useTranslations('staff.invitations')
  const [issued, setIssued] = useState<{ name: string; code: string; password: string } | null>(null)
  const [form, setForm] = useState({ full_name: '', email: '', password: '' })
  const [nameParts, setNameParts] = useState<NameParts>(EMPTY_NAME_PARTS)
  const [showNameErrors, setShowNameErrors] = useState(false)
  const [naming, setNaming] = useState<NamedStudent | null>(null)
  const tName = useTranslations('common.studentName')
  const [isUniversityStudent, setIsUniversityStudent] = useState(false)
  const [busy, setBusy] = useState('')
  const showAffiliation = role === 'student' && canSetAffiliation
  const isStudent = role === 'student'

  const q = search.trim().toLowerCase()
  const filtered = people.filter(p => !q || p.full_name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q))

  function close() {
    setOpen(false)
    setIssued(null)
    setForm({ full_name: '', email: '', password: '' })
    setNameParts(EMPTY_NAME_PARTS)
    setShowNameErrors(false)
    setIsUniversityStudent(false)
  }

  async function submit() {
    if (mode !== 'byId' && !form.email.trim()) return toast.error(t('emailRequired'))
    if (mode !== 'invite' && isStudent && !checkNameParts(nameParts).ok) {
      setShowNameErrors(true)
      return toast.error(tName('incomplete'))
    }
    setBusy('submit')
    const res = mode === 'invite'
      ? await fetch('/api/invitations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: form.email.trim(),
            role,
            ...(showAffiliation ? { is_university_student: isUniversityStudent } : {}),
          }),
        })
      : await fetch('/api/admin/create-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(mode === 'byId' ? { login_mode: 'member_id' } : { ...form, email: form.email.trim() }),
            ...(isStudent ? { full_name: undefined, name_parts: nameParts } : { full_name: form.full_name.trim() }),
            role,
            ...(showAffiliation ? { is_university_student: isUniversityStudent } : {}),
          }),
        })
    const data = await res.json().catch(() => ({}))
    setBusy('')
    if (!res.ok) return toast.error(data.error ?? t('actionFailed'))
    if (mode === 'invite') {
      toast.success(t('invited'))
    } else {
      toast.success(t(`${role}.created`))
      if (data.user) setPeople(prev => [data.user as PersonRow, ...prev])
      if (mode === 'byId') {
        // Keep the dialog open: the temporary password is shown only here.
        setIssued({ name: data.user?.full_name ?? '', code: data.member_code ?? '', password: data.temp_password ?? '' })
        setNameParts(EMPTY_NAME_PARTS)
        setShowNameErrors(false)
        router.refresh()
        return
      }
    }
    close()
    router.refresh()
  }

  async function toggleAffiliation(p: PersonRow) {
    const next = p.is_university_student === false
    setBusy(p.id)
    const res = await fetch('/api/admin/student-affiliation', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: p.id, isUniversityStudent: next }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy('')
    if (!res.ok) return toast.error(data.error ?? t('affiliationFailed'))
    setPeople(prev => prev.map(x => (x.id === p.id ? { ...x, is_university_student: next, locked: next ? 'universityStudent' : null } : x)))
    toast.success(next ? t('nowInstitution', { label: terms.institutionStudent }) : t('nowCentreOnly'))
    router.refresh()
  }

  async function toggle(p: PersonRow) {
    setBusy(p.id)
    const res = await fetch('/api/admin/toggle-user', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: p.id, isActive: !p.is_active }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy('')
    if (!res.ok) return toast.error(data.error ?? t('statusFailed'))
    setPeople(prev => prev.map(x => (x.id === p.id ? { ...x, is_active: !x.is_active } : x)))
    router.refresh()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-white">{t(`${role}.title`)}</h2>
          <p className="text-slate-400 mt-1">
            {t(`${role}.summary`, { count: people.length, active: people.filter(p => p.is_active).length })}
          </p>
        </div>
        <Button onClick={() => setOpen(true)}><UserPlus className="w-4 h-4" /> {t(`${role}.add`)}</Button>
      </div>

      <div className="relative">
        <Search className="absolute end-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('search')}
          className="w-full pe-10 ps-4 py-2.5 rounded-lg bg-slate-900 border border-slate-800 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
        />
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="text-start text-xs font-medium text-slate-400 px-5 py-3">{t('thName')}</th>
              <th className="text-start text-xs font-medium text-slate-400 px-5 py-3 hidden md:table-cell">{t('thEmail')}</th>
              <th className="text-start text-xs font-medium text-slate-400 px-5 py-3 hidden lg:table-cell">{t('thJoined')}</th>
              <th className="text-start text-xs font-medium text-slate-400 px-5 py-3">{t('thStatus')}</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {filtered.length === 0 && (
              <tr><td colSpan={5} className="text-center text-slate-500 py-10">{t('empty')}</td></tr>
            )}
            {filtered.map(p => (
              <tr key={p.id} className="hover:bg-slate-800/50">
                <td className="px-5 py-4 text-white text-sm font-medium">
                  <div className="flex flex-wrap items-center gap-2">
                    {p.full_name}
                    {isStudent && p.name_complete === false && (
                      <span title={tName('notFourPartHint')}><Badge variant="yellow">{tName('notFourPart')}</Badge></span>
                    )}
                  </div>
                </td>
                <td className="px-5 py-4 hidden md:table-cell text-slate-400 text-sm">
                  <span className="inline-flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" />{p.email}</span>
                </td>
                <td className="px-5 py-4 hidden lg:table-cell text-slate-400 text-sm">{formatDate(p.created_at, locale)}</td>
                <td className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={p.is_active ? 'green' : 'red'}>{p.is_active ? t('active') : t('disabled')}</Badge>
                    {role === 'student' && (
                      <Badge variant={p.is_university_student === false ? 'gray' : 'blue'}>
                        {p.is_university_student === false ? t('centreTrainee') : terms.institutionStudent}
                      </Badge>
                    )}
                  </div>
                </td>
                <td className="px-5 py-4 text-end">
                  <div className="flex items-center gap-1 justify-end flex-wrap">
                    {showAffiliation && (
                      <Button variant="ghost" size="sm" loading={busy === p.id} onClick={() => toggleAffiliation(p)}>
                        <GraduationCap className="w-3.5 h-3.5" />
                        {p.is_university_student === false ? t('makeInstitution', { label: terms.institutionStudent }) : t('makeCentreOnly')}
                      </Button>
                    )}
                    {isStudent && !p.locked && (
                      <Button variant="ghost" size="sm" onClick={() => setNaming(p)}>
                        <PenLine className="w-3.5 h-3.5" /> {tName('correct')}
                      </Button>
                    )}
                    {p.locked ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 px-2" title={t(`locked.${p.locked}`, { admin: terms.institutionAdmin })}>
                        <Lock className="w-3.5 h-3.5 shrink-0" /> {t(`locked.${p.locked}`, { admin: terms.institutionAdmin })}
                      </span>
                    ) : (
                      <Button variant="ghost" size="sm" loading={busy === p.id} onClick={() => toggle(p)}>
                        <Power className="w-3.5 h-3.5" /> {p.is_active ? t('disable') : t('enable')}
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={open} onClose={close} title={t(`${role}.add`)}>
        <div className="space-y-4">
          <div className="flex gap-2">
            {(isStudent ? ['invite', 'account', 'byId'] as const : ['invite', 'account'] as const).map(m => (
              <button
                key={m}
                onClick={() => { setMode(m); setIssued(null) }}
                className={`flex-1 px-3 py-2 rounded-lg text-sm border transition-colors ${
                  mode === m ? 'bg-blue-600 border-blue-600 text-white' : 'bg-slate-800 border-slate-700 text-slate-300'
                }`}
              >{m === 'invite' ? t('modeInvite') : m === 'byId' ? tInv('accountById') : t('modeAccount')}</button>
            ))}
          </div>
          <p className="text-slate-500 text-xs">
            {mode === 'invite'
              ? t('inviteHint')
              : mode === 'byId' ? tInv('accountByIdNote') : t('accountHint')}
          </p>
          {issued && (
            <div role="status" className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-4 space-y-3">
              <p className="text-emerald-300 text-sm">{tInv('accountByIdCreated', { name: issued.name })}</p>
              {[
                { label: tInv('memberIdLabel'), value: issued.code },
                { label: tInv('tempPasswordLabel'), value: issued.password },
              ].map(row => (
                <div key={row.label} className="flex items-center gap-2 bg-slate-950 rounded-lg px-3 py-2">
                  <span className="text-slate-400 text-xs w-28 shrink-0">{row.label}</span>
                  <code dir="ltr" className="text-white font-mono text-sm flex-1">{row.value}</code>
                  <button type="button" aria-label={tInv('copy')} onClick={() => navigator.clipboard.writeText(row.value)} className="text-slate-400 hover:text-white shrink-0">
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <p className="text-amber-300 text-xs">{tInv('tempPasswordOnce')}</p>
            </div>
          )}
          {mode !== 'invite' && (isStudent ? (
            <FourPartNameFields
              idPrefix="new-student-name"
              value={nameParts}
              onChange={setNameParts}
              showErrors={showNameErrors}
              hint={tName('hintStaff')}
            />
          ) : (
            <Input label={t('fullName')} value={form.full_name}
              onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} />
          ))}
          {mode !== 'byId' && (
            <Input label={t('email')} type="email" dir="ltr" value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          )}
          {mode === 'account' && (
            <Input label={t('tempPassword')} type="password" dir="ltr" value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
          )}
          {showAffiliation && (
            <label className="flex items-start gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                className="mt-1"
                checked={isUniversityStudent}
                onChange={e => setIsUniversityStudent(e.target.checked)}
              />
              <span>
                {t('alsoInstitution', { label: terms.institutionStudent })}
                <span className="block text-slate-500 text-xs">
                  {t('affiliationHint', { institution: terms.institution })}
                </span>
              </span>
            </label>
          )}
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="ghost" onClick={close}>{t('cancel')}</Button>
            <Button loading={busy === 'submit'} onClick={submit}>{mode === 'invite' ? t('sendInvite') : t('createAccount')}</Button>
          </div>
        </div>
      </Modal>

      <StudentNameEditor
        student={naming}
        onClose={() => setNaming(null)}
        onSaved={(id, fullName, isComplete) => {
          setPeople(prev => prev.map(x => (x.id === id ? { ...x, full_name: fullName, name_complete: isComplete } : x)))
          router.refresh()
        }}
      />
    </div>
  )
}
