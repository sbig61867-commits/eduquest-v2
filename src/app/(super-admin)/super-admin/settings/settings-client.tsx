'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuthStore } from '@/stores/auth-store'
import { formatDate } from '@/lib/utils'
import { User, KeyRound, CheckCircle2, Server, Sparkles, Mail, ShieldCheck, Globe, Eye, Ticket, Gauge, ClipboardCheck, Trash2, AlertTriangle } from 'lucide-react'
import type { InvitationDefaults, AiRateLimits, ExamPolicies, DeletionPolicy } from '@/lib/settings'
import { useTranslations, useLocale } from 'next-intl'
import type { Locale } from '@/i18n/config'

interface Profile {
  id: string
  full_name: string
  email: string
  role: string
  created_at: string
}

interface Config {
  groq: boolean
  gemini: boolean
  resend: boolean
  serviceRole: boolean
  appUrl: string | null
}

interface Props {
  profile: Profile | null
  config: Config
  invitationDefaults: InvitationDefaults
  aiRateLimits: AiRateLimits
  examPolicies: ExamPolicies
  deletionPolicy: DeletionPolicy
}

function StatusPill({ ok, okLabel, badLabel }: { ok: boolean; okLabel?: string; badLabel?: string }) {
  const t = useTranslations('superAdmin.settings')
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
      ok ? 'text-emerald-400 bg-emerald-400/10' : 'text-amber-400 bg-amber-400/10'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-emerald-400' : 'bg-amber-400'}`} />
      {ok ? (okLabel ?? t('configured')) : (badLabel ?? t('notConfigured'))}
    </span>
  )
}

export function SettingsClient({ profile, config, invitationDefaults, aiRateLimits, examPolicies, deletionPolicy }: Props) {
  const t = useTranslations('superAdmin.settings')
  const locale = useLocale() as Locale
  const supabase = createClient()
  const { setUser, user } = useAuthStore()

  // Profile form
  const [fullName, setFullName] = useState(profile?.full_name ?? '')
  const [savingName, setSavingName] = useState(false)
  const [nameSaved, setNameSaved] = useState(false)
  const [nameError, setNameError] = useState('')

  // AI rate limits form
  const [ai, setAi] = useState(aiRateLimits)
  const [savingAi, setSavingAi] = useState(false)
  const [aiSaved, setAiSaved] = useState(false)
  const [aiError, setAiError] = useState('')

  // Exam policies form
  const [exam, setExam] = useState(examPolicies)

  // Deletion policy
  const [del, setDel] = useState(deletionPolicy)
  const [savingDel, setSavingDel] = useState(false)
  const [delSaved, setDelSaved] = useState(false)

  async function saveDeletionPolicy(next: boolean) {
    setDel({ hard_delete_enabled: next }); setDelSaved(false); setSavingDel(true)
    const { error } = await supabase
      .from('platform_settings')
      .upsert({ key: 'deletion_policy', value: { hard_delete_enabled: next }, updated_at: new Date().toISOString() })
    if (!error) { setDelSaved(true); setTimeout(() => setDelSaved(false), 3000) }
    else setDel({ hard_delete_enabled: !next }) // revert on failure
    setSavingDel(false)
  }
  const [savingExam, setSavingExam] = useState(false)
  const [examSaved, setExamSaved] = useState(false)
  const [examError, setExamError] = useState('')

  // Invitation defaults form
  const [inv, setInv] = useState(invitationDefaults)
  const [savingInv, setSavingInv] = useState(false)
  const [invSaved, setInvSaved] = useState(false)
  const [invError, setInvError] = useState('')

  // Password form
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [savingPw, setSavingPw] = useState(false)
  const [pwSaved, setPwSaved] = useState(false)
  const [pwError, setPwError] = useState('')

  async function saveName(e: React.FormEvent) {
    e.preventDefault()
    if (!profile) return
    setSavingName(true); setNameError(''); setNameSaved(false)
    const { error } = await supabase
      .from('users')
      .update({ full_name: fullName.trim() })
      .eq('id', profile.id)
    if (error) setNameError(error.message)
    else {
      if (user) setUser({ ...user, full_name: fullName.trim() })
      setNameSaved(true)
      setTimeout(() => setNameSaved(false), 3000)
    }
    setSavingName(false)
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault()
    setPwError(''); setPwSaved(false)
    if (password.length < 8) { setPwError(t('passwordTooShort')); return }
    if (password !== password2) { setPwError(t('passwordMismatch')); return }
    setSavingPw(true)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) setPwError(error.message)
    else {
      setPassword(''); setPassword2('')
      setPwSaved(true)
      setTimeout(() => setPwSaved(false), 3000)
    }
    setSavingPw(false)
  }

  async function saveAiRateLimits(e: React.FormEvent) {
    e.preventDefault()
    setAiError(''); setAiSaved(false)
    if (!Number.isFinite(ai.lesson_per_hour) || ai.lesson_per_hour < 1 || ai.lesson_per_hour > 1000) {
      setAiError(t('lessonLimitRange')); return
    }
    if (!Number.isFinite(ai.exam_per_hour) || ai.exam_per_hour < 1 || ai.exam_per_hour > 1000) {
      setAiError(t('examLimitRange')); return
    }
    setSavingAi(true)
    const { error } = await supabase
      .from('platform_settings')
      .upsert({ key: 'ai_rate_limits', value: ai, updated_at: new Date().toISOString() })
    if (error) setAiError(error.message)
    else {
      setAiSaved(true)
      setTimeout(() => setAiSaved(false), 3000)
    }
    setSavingAi(false)
  }

  async function saveExamPolicies(e: React.FormEvent) {
    e.preventDefault()
    setExamError(''); setExamSaved(false)
    if (!Number.isFinite(exam.violation_warning_threshold) || exam.violation_warning_threshold < 1 || exam.violation_warning_threshold > 100) {
      setExamError(t('violationRange')); return
    }
    setSavingExam(true)
    const { error } = await supabase
      .from('platform_settings')
      .upsert({ key: 'exam_policies', value: exam, updated_at: new Date().toISOString() })
    if (error) setExamError(error.message)
    else {
      setExamSaved(true)
      setTimeout(() => setExamSaved(false), 3000)
    }
    setSavingExam(false)
  }

  async function saveInvitationDefaults(e: React.FormEvent) {
    e.preventDefault()
    setInvError(''); setInvSaved(false)
    const fields: Array<[keyof InvitationDefaults, string]> = [
      ['university_admin', t('roleInstitutionAdmin')], ['teacher', t('roleTeacher')], ['student', t('roleStudent')], ['max_expiry_hours', t('maximum')],
    ]
    for (const [k, label] of fields) {
      const v = inv[k]
      if (!Number.isFinite(v) || v < 1 || v > 8760) { setInvError(t('hoursRange', { label })); return }
    }
    setSavingInv(true)
    const { error } = await supabase
      .from('platform_settings')
      .upsert({ key: 'invitation_defaults', value: inv, updated_at: new Date().toISOString() })
    if (error) setInvError(error.message)
    else {
      setInvSaved(true)
      setTimeout(() => setInvSaved(false), 3000)
    }
    setSavingInv(false)
  }

  const services = [
    { label: t('services.groq'), icon: Sparkles, ok: config.groq },
    { label: t('services.gemini'), icon: Eye, ok: config.gemini },
    { label: t('services.resend'), icon: Mail, ok: config.resend },
    { label: t('services.serviceRole'), icon: ShieldCheck, ok: config.serviceRole },
  ]

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-2xl font-bold text-white">{t('title')}</h2>
        <p className="text-slate-400 mt-1">{t('subtitle')}</p>
      </div>

      {/* Account */}
      <form onSubmit={saveName} className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
        <h3 className="text-white font-semibold flex items-center gap-2">
          <User className="w-4 h-4 text-slate-400" /> {t('account')}
        </h3>
        {nameError && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{nameError}</p>}
        {nameSaved && (
          <div className="flex items-center gap-2 text-emerald-400 text-sm bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
            <CheckCircle2 className="w-4 h-4" /> {t('nameSaved')}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label={t('fullName')} value={fullName} onChange={e => setFullName(e.target.value)} required />
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-300">{t('email')}</label>
            <input value={profile?.email ?? ''} disabled
              className="w-full px-4 py-2.5 rounded-lg bg-slate-800/50 border border-slate-700 text-slate-400 text-sm cursor-not-allowed" />
          </div>
        </div>
        <p className="text-xs text-slate-500">{t('ownerSince', { date: profile ? formatDate(profile.created_at, locale) : '—' })}</p>
        <Button type="submit" loading={savingName}>{t('save')}</Button>
      </form>

      {/* Password */}
      <form onSubmit={savePassword} className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
        <h3 className="text-white font-semibold flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-slate-400" /> {t('changePassword')}
        </h3>
        {pwError && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{pwError}</p>}
        {pwSaved && (
          <div className="flex items-center gap-2 text-emerald-400 text-sm bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
            <CheckCircle2 className="w-4 h-4" /> {t('passwordSaved')}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label={t('newPassword')} type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder={t('passwordPlaceholder')} />
          <Input label={t('confirmPassword')} type="password" value={password2} onChange={e => setPassword2(e.target.value)} required placeholder={t('confirmPlaceholder')} />
        </div>
        <Button type="submit" loading={savingPw} disabled={!password || !password2}>{t('updatePassword')}</Button>
      </form>

      {/* Invitation defaults */}
      <form onSubmit={saveInvitationDefaults} className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
        <h3 className="text-white font-semibold flex items-center gap-2">
          <Ticket className="w-4 h-4 text-slate-400" /> {t('invitations')}
        </h3>
        <p className="text-slate-500 text-sm">{t('invitationsHint')}</p>
        {invError && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{invError}</p>}
        {invSaved && (
          <div className="flex items-center gap-2 text-emerald-400 text-sm bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
            <CheckCircle2 className="w-4 h-4" /> {t('invitationsSaved')}
          </div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Input label={t('roleInstitutionAdmin')} type="number" min={1} max={8760} value={inv.university_admin}
            onChange={e => setInv(p => ({ ...p, university_admin: Number(e.target.value) }))} required />
          <Input label={t('roleTeacher')} type="number" min={1} max={8760} value={inv.teacher}
            onChange={e => setInv(p => ({ ...p, teacher: Number(e.target.value) }))} required />
          <Input label={t('roleStudent')} type="number" min={1} max={8760} value={inv.student}
            onChange={e => setInv(p => ({ ...p, student: Number(e.target.value) }))} required />
          <Input label={t('maximum')} type="number" min={1} max={8760} value={inv.max_expiry_hours}
            onChange={e => setInv(p => ({ ...p, max_expiry_hours: Number(e.target.value) }))} required />
        </div>
        <Button type="submit" loading={savingInv}>{t('saveDefaults')}</Button>
      </form>

      {/* AI rate limits */}
      <form onSubmit={saveAiRateLimits} className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
        <h3 className="text-white font-semibold flex items-center gap-2">
          <Gauge className="w-4 h-4 text-slate-400" /> {t('aiLimits')}
        </h3>
        <p className="text-slate-500 text-sm">{t('aiLimitsHint')}</p>
        {aiError && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{aiError}</p>}
        {aiSaved && (
          <div className="flex items-center gap-2 text-emerald-400 text-sm bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
            <CheckCircle2 className="w-4 h-4" /> {t('aiSaved')}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label={t('lessonsPerHour')} type="number" min={1} max={1000}
            value={ai.lesson_per_hour}
            onChange={e => setAi(p => ({ ...p, lesson_per_hour: Number(e.target.value) }))} required />
          <Input label={t('examsPerHour')} type="number" min={1} max={1000}
            value={ai.exam_per_hour}
            onChange={e => setAi(p => ({ ...p, exam_per_hour: Number(e.target.value) }))} required />
        </div>
        <Button type="submit" loading={savingAi}>{t('saveLimits')}</Button>
      </form>

      {/* Exam policies */}
      <form onSubmit={saveExamPolicies} className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
        <h3 className="text-white font-semibold flex items-center gap-2">
          <ClipboardCheck className="w-4 h-4 text-slate-400" /> {t('examPolicies')}
        </h3>
        <p className="text-slate-500 text-sm">{t('examPoliciesHint')}</p>
        {examError && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{examError}</p>}
        {examSaved && (
          <div className="flex items-center gap-2 text-emerald-400 text-sm bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
            <CheckCircle2 className="w-4 h-4" /> {t('examSaved')}
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-slate-300 text-sm font-medium">{t('proctoringDefault')}</p>
            <p className="text-slate-500 text-xs">{t('proctoringDefaultHint')}</p>
          </div>
          <button type="button" role="switch" aria-checked={exam.proctoring_default_enabled} aria-label={t('proctoringDefault')}
            onClick={() => setExam(p => ({ ...p, proctoring_default_enabled: !p.proctoring_default_enabled }))}
            className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer shrink-0 ${exam.proctoring_default_enabled ? 'bg-blue-600' : 'bg-slate-700'}`}>
            <span className={`absolute top-0.5 start-0 w-4 h-4 rounded-full bg-white transition-transform ${exam.proctoring_default_enabled ? 'translate-x-5 rtl:-translate-x-5' : 'translate-x-0.5 rtl:-translate-x-0.5'}`} />
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label={t('violationThreshold')} type="number" min={1} max={100}
            value={exam.violation_warning_threshold}
            onChange={e => setExam(p => ({ ...p, violation_warning_threshold: Number(e.target.value) }))} required />
        </div>
        <p className="text-xs text-slate-500">{t('violationThresholdHint')}</p>
        <Button type="submit" loading={savingExam}>{t('savePolicies')}</Button>
      </form>

      {/* Deletion policy */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
        <h3 className="text-white font-semibold flex items-center gap-2">
          <Trash2 className="w-4 h-4 text-slate-400" /> {t('deletion')}
        </h3>
        <p className="text-slate-500 text-sm">{t('deletionHint')}</p>
        {delSaved && (
          <div className="flex items-center gap-2 text-emerald-400 text-sm bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
            <CheckCircle2 className="w-4 h-4" /> {t('deletionSaved')}
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-slate-300 text-sm font-medium">{t('allowHardDelete')}</p>
            <p className="text-slate-500 text-xs">
              {del.hard_delete_enabled ? t('hardDeleteOn') : t('hardDeleteOff')}
            </p>
          </div>
          <button type="button" role="switch" aria-checked={del.hard_delete_enabled} aria-label={t('allowHardDelete')} disabled={savingDel}
            onClick={() => saveDeletionPolicy(!del.hard_delete_enabled)}
            className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer shrink-0 ${del.hard_delete_enabled ? 'bg-red-600' : 'bg-slate-700'} ${savingDel ? 'opacity-60' : ''}`}>
            <span className={`absolute top-0.5 start-0 w-4 h-4 rounded-full bg-white transition-transform ${del.hard_delete_enabled ? 'translate-x-5 rtl:-translate-x-5' : 'translate-x-0.5 rtl:-translate-x-0.5'}`} />
          </button>
        </div>
        {del.hard_delete_enabled && (
          <div className="flex items-start gap-2 text-red-300 text-xs bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{t('hardDeleteWarning')}</span>
          </div>
        )}
      </div>

      {/* Platform configuration health */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
        <h3 className="text-white font-semibold flex items-center gap-2">
          <Server className="w-4 h-4 text-slate-400" /> {t('configuration')}
        </h3>
        <div className="space-y-3">
          {services.map(s => {
            const Icon = s.icon
            return (
              <div key={s.label} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-slate-300 text-sm">
                  <Icon className="w-4 h-4 text-slate-500" /> {s.label}
                </span>
                <StatusPill ok={s.ok} />
              </div>
            )
          })}
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-slate-300 text-sm">
              <Eye className="w-4 h-4 text-slate-500" /> {t('proctoringAnalysis')}
            </span>
            {/* Always on-device since 2026-09-13 — the server-side Gemini layer
                and its NEXT_PUBLIC_SERVER_PROCTORING flag were removed. */}
            <StatusPill ok okLabel={t('onDevice')} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-slate-300 text-sm">
              <Globe className="w-4 h-4 text-slate-500" /> {t('appUrl')}
            </span>
            <span className="text-slate-400 text-xs font-mono truncate max-w-[220px]">{config.appUrl ?? t('appUrlUnset')}</span>
          </div>
        </div>
        <p className="text-xs text-slate-500">
          {t.rich('envHint', { code: chunks => <code className="text-slate-400">{chunks}</code> })}
        </p>
      </div>
    </div>
  )
}
