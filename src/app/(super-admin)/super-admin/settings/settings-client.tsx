'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuthStore } from '@/stores/auth-store'
import { formatDate } from '@/lib/utils'
import { User, KeyRound, CheckCircle2, Server, Sparkles, Mail, ShieldCheck, Globe, Eye, Ticket, Gauge, ClipboardCheck, Trash2, AlertTriangle } from 'lucide-react'
import type { InvitationDefaults, AiRateLimits, ExamPolicies, DeletionPolicy } from '@/lib/settings'

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
  serverProctoring: boolean
}

interface Props {
  profile: Profile | null
  config: Config
  invitationDefaults: InvitationDefaults
  aiRateLimits: AiRateLimits
  examPolicies: ExamPolicies
  deletionPolicy: DeletionPolicy
}

function StatusPill({ ok, okLabel = 'Configured', badLabel = 'Not configured' }: { ok: boolean; okLabel?: string; badLabel?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
      ok ? 'text-emerald-400 bg-emerald-400/10' : 'text-amber-400 bg-amber-400/10'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-emerald-400' : 'bg-amber-400'}`} />
      {ok ? okLabel : badLabel}
    </span>
  )
}

export function SettingsClient({ profile, config, invitationDefaults, aiRateLimits, examPolicies, deletionPolicy }: Props) {
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
    if (password.length < 8) { setPwError('Password must be at least 8 characters.'); return }
    if (password !== password2) { setPwError('Passwords do not match.'); return }
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
      setAiError('Lesson limit must be between 1 and 1000.'); return
    }
    if (!Number.isFinite(ai.exam_per_hour) || ai.exam_per_hour < 1 || ai.exam_per_hour > 1000) {
      setAiError('Exam limit must be between 1 and 1000.'); return
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
      setExamError('Violation threshold must be between 1 and 100.'); return
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
      ['university_admin', 'University Admin'], ['teacher', 'Teacher'], ['student', 'Student'], ['max_expiry_hours', 'Maximum'],
    ]
    for (const [k, label] of fields) {
      const v = inv[k]
      if (!Number.isFinite(v) || v < 1 || v > 8760) { setInvError(`${label} hours must be between 1 and 8760.`); return }
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
    { label: 'Groq (lesson & exam generation)', icon: Sparkles, ok: config.groq },
    { label: 'Gemini (vision / proctoring / fallback)', icon: Eye, ok: config.gemini },
    { label: 'Resend (invitation emails)', icon: Mail, ok: config.resend },
    { label: 'Supabase service role (admin APIs)', icon: ShieldCheck, ok: config.serviceRole },
  ]

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-2xl font-bold text-white">Platform Settings</h2>
        <p className="text-slate-400 mt-1">Your account and platform configuration</p>
      </div>

      {/* Account */}
      <form onSubmit={saveName} className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
        <h3 className="text-white font-semibold flex items-center gap-2">
          <User className="w-4 h-4 text-slate-400" /> Account
        </h3>
        {nameError && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{nameError}</p>}
        {nameSaved && (
          <div className="flex items-center gap-2 text-emerald-400 text-sm bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
            <CheckCircle2 className="w-4 h-4" /> Name updated
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="Full Name" value={fullName} onChange={e => setFullName(e.target.value)} required />
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-300">Email</label>
            <input value={profile?.email ?? ''} disabled
              className="w-full px-4 py-2.5 rounded-lg bg-slate-800/50 border border-slate-700 text-slate-400 text-sm cursor-not-allowed" />
          </div>
        </div>
        <p className="text-xs text-slate-500">Super admin since {profile ? formatDate(profile.created_at) : '—'}</p>
        <Button type="submit" loading={savingName}>Save</Button>
      </form>

      {/* Password */}
      <form onSubmit={savePassword} className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
        <h3 className="text-white font-semibold flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-slate-400" /> Change Password
        </h3>
        {pwError && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{pwError}</p>}
        {pwSaved && (
          <div className="flex items-center gap-2 text-emerald-400 text-sm bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
            <CheckCircle2 className="w-4 h-4" /> Password updated
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="New Password" type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="At least 8 characters" />
          <Input label="Confirm Password" type="password" value={password2} onChange={e => setPassword2(e.target.value)} required placeholder="Repeat new password" />
        </div>
        <Button type="submit" loading={savingPw} disabled={!password || !password2}>Update Password</Button>
      </form>

      {/* Invitation defaults */}
      <form onSubmit={saveInvitationDefaults} className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
        <h3 className="text-white font-semibold flex items-center gap-2">
          <Ticket className="w-4 h-4 text-slate-400" /> Invitation Defaults
        </h3>
        <p className="text-slate-500 text-sm">
          Default link validity (in hours) per invited role, used when the inviter doesn&apos;t set one. The maximum caps every invitation.
        </p>
        {invError && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{invError}</p>}
        {invSaved && (
          <div className="flex items-center gap-2 text-emerald-400 text-sm bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
            <CheckCircle2 className="w-4 h-4" /> Invitation defaults saved
          </div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Input label="University Admin" type="number" min={1} max={8760} value={inv.university_admin}
            onChange={e => setInv(p => ({ ...p, university_admin: Number(e.target.value) }))} required />
          <Input label="Teacher" type="number" min={1} max={8760} value={inv.teacher}
            onChange={e => setInv(p => ({ ...p, teacher: Number(e.target.value) }))} required />
          <Input label="Student" type="number" min={1} max={8760} value={inv.student}
            onChange={e => setInv(p => ({ ...p, student: Number(e.target.value) }))} required />
          <Input label="Maximum (cap)" type="number" min={1} max={8760} value={inv.max_expiry_hours}
            onChange={e => setInv(p => ({ ...p, max_expiry_hours: Number(e.target.value) }))} required />
        </div>
        <Button type="submit" loading={savingInv}>Save Defaults</Button>
      </form>

      {/* AI rate limits */}
      <form onSubmit={saveAiRateLimits} className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
        <h3 className="text-white font-semibold flex items-center gap-2">
          <Gauge className="w-4 h-4 text-slate-400" /> AI Rate Limits
        </h3>
        <p className="text-slate-500 text-sm">
          Maximum AI generation calls per user per hour. Resets automatically every 60 minutes.
        </p>
        {aiError && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{aiError}</p>}
        {aiSaved && (
          <div className="flex items-center gap-2 text-emerald-400 text-sm bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
            <CheckCircle2 className="w-4 h-4" /> AI rate limits saved
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="Lesson generation / hour" type="number" min={1} max={1000}
            value={ai.lesson_per_hour}
            onChange={e => setAi(p => ({ ...p, lesson_per_hour: Number(e.target.value) }))} required />
          <Input label="Exam generation / hour" type="number" min={1} max={1000}
            value={ai.exam_per_hour}
            onChange={e => setAi(p => ({ ...p, exam_per_hour: Number(e.target.value) }))} required />
        </div>
        <Button type="submit" loading={savingAi}>Save Limits</Button>
      </form>

      {/* Exam policies */}
      <form onSubmit={saveExamPolicies} className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
        <h3 className="text-white font-semibold flex items-center gap-2">
          <ClipboardCheck className="w-4 h-4 text-slate-400" /> Exam Policies
        </h3>
        <p className="text-slate-500 text-sm">
          Platform-wide defaults for new exams. Teachers can still toggle proctoring per exam.
        </p>
        {examError && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{examError}</p>}
        {examSaved && (
          <div className="flex items-center gap-2 text-emerald-400 text-sm bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
            <CheckCircle2 className="w-4 h-4" /> Exam policies saved
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-slate-300 text-sm font-medium">Proctoring enabled by default</p>
            <p className="text-slate-500 text-xs">New exams start with AI proctoring turned on</p>
          </div>
          <div onClick={() => setExam(p => ({ ...p, proctoring_default_enabled: !p.proctoring_default_enabled }))}
            className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer shrink-0 ${exam.proctoring_default_enabled ? 'bg-blue-600' : 'bg-slate-700'}`}>
            <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${exam.proctoring_default_enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="Violation warning threshold" type="number" min={1} max={100}
            value={exam.violation_warning_threshold}
            onChange={e => setExam(p => ({ ...p, violation_warning_threshold: Number(e.target.value) }))} required />
        </div>
        <p className="text-xs text-slate-500">The student sees a persistent red warning once their proctoring violations reach this number.</p>
        <Button type="submit" loading={savingExam}>Save Policies</Button>
      </form>

      {/* Deletion policy */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
        <h3 className="text-white font-semibold flex items-center gap-2">
          <Trash2 className="w-4 h-4 text-slate-400" /> Deletion Policy
        </h3>
        <p className="text-slate-500 text-sm">
          Controls what happens when a teacher or admin deletes a group, lesson, exam, or homework across the whole platform.
        </p>
        {delSaved && (
          <div className="flex items-center gap-2 text-emerald-400 text-sm bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
            <CheckCircle2 className="w-4 h-4" /> Deletion policy saved
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-slate-300 text-sm font-medium">Allow permanent deletion</p>
            <p className="text-slate-500 text-xs">
              {del.hard_delete_enabled
                ? 'ON — deletes permanently erase data (with all submissions & grades). Irreversible.'
                : 'OFF — deletes move items to the archive (data preserved, recoverable). Recommended.'}
            </p>
          </div>
          <div onClick={() => !savingDel && saveDeletionPolicy(!del.hard_delete_enabled)}
            className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer shrink-0 ${del.hard_delete_enabled ? 'bg-red-600' : 'bg-slate-700'} ${savingDel ? 'opacity-60' : ''}`}>
            <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${del.hard_delete_enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </div>
        </div>
        {del.hard_delete_enabled && (
          <div className="flex items-start gap-2 text-red-300 text-xs bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>Permanent deletion is active. Deleted groups/exams and their students’ submissions and grades will be erased for good and will NOT appear in the archive.</span>
          </div>
        )}
      </div>

      {/* Platform configuration health */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
        <h3 className="text-white font-semibold flex items-center gap-2">
          <Server className="w-4 h-4 text-slate-400" /> Platform Configuration
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
              <Eye className="w-4 h-4 text-slate-500" /> Server-side proctoring analysis
            </span>
            <StatusPill ok={config.serverProctoring} okLabel="Enabled" badLabel="Disabled" />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-slate-300 text-sm">
              <Globe className="w-4 h-4 text-slate-500" /> App base URL (invitation links)
            </span>
            <span className="text-slate-400 text-xs font-mono truncate max-w-[220px]">{config.appUrl ?? 'not set — falls back to Vercel/localhost'}</span>
          </div>
        </div>
        <p className="text-xs text-slate-500">
          These values come from environment variables on the server. To change them, edit <code className="text-slate-400">.env.local</code> (or your Vercel project settings) and redeploy.
        </p>
      </div>
    </div>
  )
}
