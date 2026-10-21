'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import type { Locale } from '@/i18n/config'
import type { Role } from '@/types'
import { getRoleLabel } from '@/lib/utils'
import { Mail, Link, Plus, X, Copy, Check, Clock, UserCheck, Ban, RefreshCw, Users, UserPlus } from 'lucide-react'
import type { Invitation } from '@/types'
import { formatDate } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { getTerms } from '@/lib/terminology'
import type { SeatRole, SeatStatus } from '@/lib/seat-limit'
import { checkNameParts, EMPTY_NAME_PARTS, type NameParts } from '@/lib/person-name'
import { FourPartNameFields } from '@/components/shared/four-part-name-fields'

interface Props {
  callerRole: 'super_admin' | 'university_admin' | 'teacher'
  tenants: { id: string; name: string }[]
  groups:  { id: string; name: string }[]
}

// Role KEYS only — the displayed name comes from getRoleLabel(role, type,
// locale) at render, so it follows both the tenant's vocabulary and the
// active language instead of being frozen at import.
const ROLE_OPTIONS: Record<string, Role[]> = {
  super_admin:      ['university_admin', 'center_manager', 'teacher', 'student'],
  university_admin: ['center_manager', 'teacher', 'student'],
  teacher:          ['student'],
}

// Roles that MUST always use a private (email-specific) invitation.
// Staff roles are never handed out as a shareable public link.
const PRIVATE_ONLY_ROLES = new Set(['university_admin', 'center_manager'])

const STATUS_COLORS: Record<string, string> = {
  pending:   'text-amber-400 bg-amber-400/10',
  accepted:  'text-emerald-400 bg-emerald-400/10',
  revoked:   'text-slate-400 bg-slate-400/10',
  depleted:  'text-purple-400 bg-purple-400/10',
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  pending:   <Clock className="w-3 h-3" />,
  accepted:  <UserCheck className="w-3 h-3" />,
  revoked:   <Ban className="w-3 h-3" />,
  depleted:  <Users className="w-3 h-3" />,
}

type InvitationRow = Invitation & {
  is_public?: boolean
  max_uses?: number | null
  use_count?: number
}

export function InvitationsClient({ callerRole, tenants, groups }: Props) {
  const t = useTranslations('staff.invitations')
  const locale = useLocale() as Locale
  const [invitations, setInvitations] = useState<InvitationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Form state
  // Super admin has no own tenant: the server decides for the chosen one.
  const ownTenant = useAuthStore(s => s.tenant)
  const hasCenter = callerRole === 'super_admin' || ownTenant?.has_center !== false
  const terms = getTerms(ownTenant?.institution_type, locale)
  const roleOptions = ROLE_OPTIONS[callerRole].filter(r => hasCenter || r !== 'center_manager')
  const [isPublic, setIsPublic]       = useState(false)
  const [email, setEmail]             = useState('')
  const [role, setRole]               = useState<string>(roleOptions[0])
  const [tenantId, setTenantId]       = useState(tenants[0]?.id ?? '')
  const [groupId, setGroupId]         = useState('')
  // Which student population the invited account joins — carried on the
  // invitation and applied when it is accepted.
  const [isUniversityStudent, setIsUniversityStudent] = useState(true)
  const [expiresHours, setExpiresHours] = useState(48)
  const [maxUses, setMaxUses]         = useState<number | ''>('')
  const [formError, setFormError]     = useState('')
  const [creating, setCreating]       = useState(false)
  const [newLink, setNewLink]         = useState<string | null>(null)
  // The institution's plan seats (null for the owner, who picks a tenant).
  const [seats, setSeats]             = useState<Record<SeatRole, SeatStatus> | null>(null)
  const fullRoles = seats ? (Object.keys(seats) as SeatRole[]).filter(r => !seats[r].allowed) : []
  const roleFull = (fullRoles as string[]).includes(role)

  // Third way to add a student: create the account directly (four-part name +
  // temporary password) through /api/admin/create-user instead of a link.
  const tName = useTranslations('common.studentName')
  const [direct, setDirect]           = useState(false)
  const [nameParts, setNameParts]     = useState<NameParts>(EMPTY_NAME_PARTS)
  const [showNameErrors, setShowNameErrors] = useState(false)
  const [password, setPassword]       = useState('')
  const [createdAccount, setCreatedAccount] = useState<{ name: string; email: string } | null>(null)
  // A direct account either uses the student's email, or has none: the
  // platform issues a member ID + temporary password (shown once, below).
  const [byId, setById]               = useState(false)
  const [createdById, setCreatedById] = useState<{ name: string; code: string; password: string } | null>(null)
  // Remounts the name fields after a creation, so their "left this field"
  // marks do not paint the emptied fields red.
  const [nameFieldsKey, setNameFieldsKey] = useState(0)
  const createdRef = useRef<HTMLDivElement>(null)
  // The result sits above the form; bring it into view.
  useEffect(() => {
    if (createdById || createdAccount) createdRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
  }, [createdById, createdAccount])

  function pickMode(next: 'private' | 'public' | 'account') {
    setIsPublic(next === 'public')
    setDirect(next === 'account')
    setNewLink(null)
    setCreatedAccount(null)
    setCreatedById(null)
    setFormError('')
  }

  // When role changes to university_admin, force private
  const handleRoleChange = (newRole: string) => {
    setRole(newRole)
    setGroupId('')
    if (PRIVATE_ONLY_ROLES.has(newRole)) setIsPublic(false)
    if (newRole !== 'student') setDirect(false)
  }

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/invitations')
    const data = await res.json()
    setInvitations(data.invitations ?? [])
    setSeats(data.seats ?? null)
    setLoading(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/invitations')
      .then(r => r.json())
      .then(data => {
        if (!cancelled) {
          setInvitations(data.invitations ?? [])
          setSeats(data.seats ?? null)
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [])

  async function createInvitation(e: React.FormEvent) {
    e.preventDefault()
    setFormError('')
    setCreating(true)
    setNewLink(null)

    const body: Record<string, unknown> = {
      role,
      expires_hours: expiresHours,
      is_public: isPublic,
    }
    if (!isPublic) body.email = email
    if (isPublic && maxUses !== '') body.max_uses = maxUses
    if (callerRole === 'super_admin' && tenantId) body.tenant_id = tenantId
    if (role === 'student' && groupId) body.group_id = groupId
    if (role === 'student' && callerRole !== 'teacher') body.is_university_student = isUniversityStudent

    const res = await fetch('/api/invitations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()

    if (!res.ok) {
      setFormError(data.error ?? t('createFailed'))
      setCreating(false)
      return
    }

    setNewLink(data.joinUrl)
    setEmail('')
    setGroupId('')
    setMaxUses('')
    setCreating(false)
    setLoading(true)
    void load()
  }

  async function createAccount(e: React.FormEvent) {
    e.preventDefault()
    setFormError('')
    setCreatedAccount(null)
    setCreatedById(null)
    if (!checkNameParts(nameParts).ok) {
      setShowNameErrors(true)
      setFormError(tName('incomplete'))
      return
    }
    // A teacher adds students into one of their own groups only.
    if (callerRole === 'teacher' && !groupId) {
      setFormError(t('accountGroupRequired'))
      return
    }
    setCreating(true)

    const body: Record<string, unknown> = {
      role: 'student',
      ...(byId ? { login_mode: 'member_id' } : { email: email.trim(), password }),
      name_parts: nameParts,
    }
    if (groupId) body.group_id = groupId
    if (callerRole === 'super_admin' && tenantId) body.tenant_id = tenantId
    if (callerRole !== 'teacher') body.is_university_student = isUniversityStudent

    const res = await fetch('/api/admin/create-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    setCreating(false)

    if (!res.ok) {
      setFormError(data.error ?? t('accountFailed'))
      return
    }

    if (byId) setCreatedById({ name: data.user?.full_name ?? '', code: data.member_code ?? '', password: data.temp_password ?? '' })
    else setCreatedAccount({ name: data.user?.full_name ?? '', email: data.user?.email ?? email.trim() })
    setNameParts(EMPTY_NAME_PARTS)
    setShowNameErrors(false)
    setNameFieldsKey(k => k + 1)
    setEmail('')
    setPassword('')
    setGroupId('')
  }

  async function revoke(id: string) {
    await fetch(`/api/invitations/${id}`, { method: 'PATCH' })
    setLoading(true)
    void load()
  }

  async function copyLink(inv: InvitationRow) {
    const base = window.location.origin
    const url = `${base}/join/${inv.token}`
    await navigator.clipboard.writeText(url)
    setCopiedId(inv.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const isExpired = (inv: InvitationRow) =>
    inv.status === 'pending' && new Date(inv.expires_at) < new Date()

  // Public links that reached max_uses show as "depleted" not "revoked"
  const resolvedStatus = (inv: InvitationRow) => {
    if (inv.is_public && inv.status === 'revoked' && inv.max_uses != null && (inv.use_count ?? 0) >= inv.max_uses) {
      return 'depleted'
    }
    return inv.status
  }

  const canBePublic = !PRIVATE_ONLY_ROLES.has(role)

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">{t('title')}</h1>
          <p className="text-slate-400 text-sm mt-1">
            {t('subtitle')}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => { setShowForm(f => !f); setNewLink(null); setFormError('') }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            {t('newInvite')}
          </button>
        </div>
      </div>

      {/* Plan limit reached: new links for that role are paused until the
          platform raises the limit (the server refuses them regardless). */}
      {fullRoles.map(r => (
        <div key={r} className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 text-amber-300 text-sm">
          {t('seatFull', { role: getRoleLabel(r, ownTenant?.institution_type, locale), limit: seats![r].limit ?? 0 })}
        </div>
      ))}

      {/* Create Form */}
      {showForm && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-white font-semibold flex items-center gap-2">
              {direct
                ? <><UserPlus className="w-4 h-4 text-emerald-400" /> {t('accountTab')}</>
                : isPublic
                  ? <><Link className="w-4 h-4 text-purple-400" /> {t('publicTab')}</>
                  : <><Mail className="w-4 h-4 text-blue-400" /> {t('privateTab')}</>
              }
            </h2>
            <button onClick={() => setShowForm(false)} className="text-slate-500 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Link type toggle */}
          <div className="flex rounded-lg border border-slate-700 overflow-hidden text-sm">
            <button
              type="button"
              onClick={() => pickMode('private')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 transition-colors ${
                !isPublic && !direct
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Mail className="w-3.5 h-3.5" />
              {t('privateDesc')}
            </button>
            <button
              type="button"
              onClick={() => canBePublic && pickMode('public')}
              disabled={!canBePublic}
              title={!canBePublic ? 'Institution Admin invitations must be email-specific' : undefined}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 transition-colors ${
                isPublic
                  ? 'bg-purple-600 text-white'
                  : canBePublic
                    ? 'text-slate-400 hover:text-white hover:bg-slate-800'
                    : 'text-slate-600 cursor-not-allowed'
              }`}
            >
              <Link className="w-3.5 h-3.5" />
              {t('publicDesc')}
            </button>
            {role === 'student' && (
              <button
                type="button"
                onClick={() => pickMode('account')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 transition-colors ${
                  direct
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                <UserPlus className="w-3.5 h-3.5" />
                {t('accountDesc')}
              </button>
            )}
          </div>

          {direct && (
            <div className="flex rounded-lg border border-slate-700 overflow-hidden text-xs">
              {([false, true] as const).map(v => (
                <button key={String(v)} type="button" aria-pressed={byId === v}
                  onClick={() => { setById(v); setCreatedById(null); setCreatedAccount(null); setFormError('') }}
                  className={`flex-1 py-2 transition-colors ${byId === v ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}>
                  {v ? t('accountById') : t('accountByEmail')}
                </button>
              ))}
            </div>
          )}

          {direct && (
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-4 py-3 text-emerald-300 text-sm">
              {byId ? t('accountByIdNote') : t('accountNote')}
            </div>
          )}

          {createdById && (
            <div ref={createdRef} role="status" className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-4 space-y-3">
              <p className="text-emerald-300 text-sm">{t('accountByIdCreated', { name: createdById.name })}</p>
              {[
                { label: t('memberIdLabel'), value: createdById.code },
                { label: t('tempPasswordLabel'), value: createdById.password },
              ].map(row => (
                <div key={row.label} className="flex items-center gap-2 bg-slate-950 rounded-lg px-3 py-2">
                  <span className="text-slate-400 text-xs w-28 shrink-0">{row.label}</span>
                  <code dir="ltr" className="text-white font-mono text-sm flex-1">{row.value}</code>
                  <button type="button" aria-label={t('copy')} onClick={() => navigator.clipboard.writeText(row.value)} className="text-slate-400 hover:text-white shrink-0">
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <p className="text-amber-300 text-xs">{t('tempPasswordOnce')}</p>
            </div>
          )}

          {createdAccount && (
            <div ref={createdRef} role="status" className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-4 text-emerald-300 text-sm">
              {t('accountCreated', createdAccount)}
            </div>
          )}

          {isPublic && (
            <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg px-4 py-3 text-purple-300 text-sm">
              {t.rich('publicNote', { role: () => <strong>{getRoleLabel(role as Role, ownTenant?.institution_type, locale)}</strong> })}
              {role === 'student' && groupId && ' They will automatically join the selected group.'}
            </div>
          )}

          {newLink && (
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-4 space-y-2">
              <p className="text-emerald-400 text-sm font-semibold">{t('createdTitle')}</p>
              <p className="text-slate-300 text-xs">{t('copyHint')}</p>
              <div className="flex items-center gap-2 bg-slate-950 rounded-lg px-3 py-2">
                <code className="text-blue-300 text-xs flex-1 break-all">{newLink}</code>
                <button
                  onClick={() => navigator.clipboard.writeText(newLink)}
                  className="text-slate-400 hover:text-white shrink-0"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {formError && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
              {formError}
            </div>
          )}

          <form onSubmit={direct ? createAccount : createInvitation} className="grid grid-cols-2 gap-4">

            {/* Direct account: the student's four-part name, typed by staff */}
            {direct && (
              <div className="col-span-2">
                <FourPartNameFields
                  key={nameFieldsKey}
                  idPrefix="direct-student-name"
                  value={nameParts}
                  onChange={setNameParts}
                  showErrors={showNameErrors}
                  hint={tName('hintStaff')}
                />
              </div>
            )}

            {/* Email — for private invitations and direct accounts by email */}
            {!isPublic && !(direct && byId) && (
              <div className="col-span-2">
                <label htmlFor="invite-email" className="block text-sm text-slate-400 mb-1">{t('emailLabel')}</label>
                <input
                  id="invite-email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  dir="ltr"
                  placeholder="invitee@school.edu"
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>
            )}

            {direct && !byId && (
              <div className="col-span-2">
                <label htmlFor="direct-password" className="block text-sm text-slate-400 mb-1">{t('passwordLabel')}</label>
                <input
                  id="direct-password"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  minLength={8}
                  dir="ltr"
                  autoComplete="new-password"
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
                <p className="text-xs text-slate-500 mt-1">{t('passwordHint')}</p>
              </div>
            )}

            <div>
              <label htmlFor="invite-role" className="block text-sm text-slate-400 mb-1">{t('roleLabel')}</label>
              <select
                id="invite-role"
                value={role}
                onChange={e => handleRoleChange(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              >
                {roleOptions.map(r => (
                  <option key={r} value={r}>{getRoleLabel(r, ownTenant?.institution_type, locale)}</option>
                ))}
              </select>
            </div>

            {callerRole === 'super_admin' && (
              <div>
                <label className="block text-sm text-slate-400 mb-1">{t('tenantLabel')}</label>
                <select
                  value={tenantId}
                  onChange={e => setTenantId(e.target.value)}
                  required
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                >
                  {tenants.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
            )}

            {role === 'student' && groups.length > 0 && (
              <div>
                <label htmlFor="invite-group" className="block text-sm text-slate-400 mb-1">
                  {isPublic || (direct && callerRole === 'teacher') ? t('groupLabel') : t('groupOptional')}
                </label>
                <select
                  id="invite-group"
                  value={groupId}
                  onChange={e => setGroupId(e.target.value)}
                  required={direct && callerRole === 'teacher'}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                >
                  <option value="">{t('pickGroup')}</option>
                  {groups.map(g => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </div>
            )}

            {role === 'student' && callerRole !== 'teacher' && hasCenter && (
              <div className="col-span-2">
                <label className="flex items-start gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={isUniversityStudent}
                    onChange={e => setIsUniversityStudent(e.target.checked)}
                  />
                  <span>
                    {callerRole === 'super_admin' ? 'Institution student' : terms.institutionStudent}
                    <span className="block text-slate-500 text-xs">
                      {t('affiliationNote')}
                    </span>
                  </span>
                </label>
              </div>
            )}

            {!direct && (
              <div>
                <label className="block text-sm text-slate-400 mb-1">{t('expiryLabel')}</label>
                <input
                  type="number"
                  value={expiresHours}
                  onChange={e => setExpiresHours(Number(e.target.value))}
                  min={1}
                  max={720}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>
            )}

            {/* Max uses — only for public links */}
            {isPublic && (
              <div>
                <label className="block text-sm text-slate-400 mb-1">{t('maxUsesLabel')}</label>
                <input
                  type="number"
                  value={maxUses}
                  onChange={e => setMaxUses(e.target.value === '' ? '' : Number(e.target.value))}
                  min={1}
                  placeholder={t('maxUsesPlaceholder')}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
                />
              </div>
            )}

            <div className="col-span-2 flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-4 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 text-sm transition-colors"
              >
                {t('cancel')}
              </button>
              <button
                type="submit"
                disabled={creating || roleFull}
                className={`px-4 py-2 rounded-lg text-white text-sm font-medium transition-colors disabled:opacity-60 ${
                  direct
                    ? 'bg-emerald-600 hover:bg-emerald-500'
                    : isPublic
                      ? 'bg-purple-600 hover:bg-purple-500'
                      : 'bg-blue-600 hover:bg-blue-500'
                }`}
              >
                {creating ? t('creating') : direct ? t('createAccount') : isPublic ? t('createPublic') : t('createPrivate')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Invitations Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : invitations.length === 0 ? (
          <div className="text-center py-16 space-y-2">
            <Mail className="w-10 h-10 text-slate-600 mx-auto" />
            <p className="text-slate-400 text-sm">{t('empty')}</p>
            <p className="text-slate-500 text-xs">{t('emptyHint')}</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-start px-5 py-3 text-slate-400 font-medium">{t('thTarget')}</th>
                <th className="text-start px-5 py-3 text-slate-400 font-medium">{t('thRole')}</th>
                {callerRole === 'super_admin' && (
                  <th className="text-start px-5 py-3 text-slate-400 font-medium">{t('thTenant')}</th>
                )}
                <th className="text-start px-5 py-3 text-slate-400 font-medium">{t('thStatus')}</th>
                <th className="text-start px-5 py-3 text-slate-400 font-medium">{t('thUses')}</th>
                <th className="text-end px-5 py-3 text-slate-400 font-medium">{t('thActions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {invitations.map(inv => {
                const expired = isExpired(inv)
                return (
                  <tr key={inv.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-5 py-3">
                      {inv.is_public ? (
                        <span className="inline-flex items-center gap-1.5 text-purple-400">
                          <Link className="w-3.5 h-3.5" />
                          {t('publicLink')}
                        </span>
                      ) : (
                        <span className="text-white font-medium">{inv.email}</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-slate-300">{getRoleLabel(inv.role as Role, ownTenant?.institution_type, locale)}</span>
                    </td>
                    {callerRole === 'super_admin' && (
                      <td className="px-5 py-3 text-slate-300">
                        {(inv as unknown as { tenants: { name: string } }).tenants?.name ?? '—'}
                      </td>
                    )}
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                        expired
                          ? 'text-red-400 bg-red-400/10'
                          : STATUS_COLORS[inv.status]
                      }`}>
                        {expired ? <Clock className="w-3 h-3" /> : STATUS_ICONS[resolvedStatus(inv)] ?? STATUS_ICONS[inv.status]}
                        {expired ? t('statusExpired') : t(`status${resolvedStatus(inv).charAt(0).toUpperCase()}${resolvedStatus(inv).slice(1)}`)}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-400 text-xs space-y-0.5">
                      {inv.is_public && (
                        <div className="flex items-center gap-1 text-purple-400">
                          <Users className="w-3 h-3" />
                          {inv.use_count ?? 0}
                          {inv.max_uses != null ? ` / ${inv.max_uses}` : ' used'}
                        </div>
                      )}
                      <div dir="ltr" className="whitespace-nowrap">{formatDate(inv.expires_at, locale)}</div>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {inv.status === 'pending' && !expired && (
                          <>
                            <button
                              onClick={() => copyLink(inv)}
                              title={t('copyLink')}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                            >
                              {copiedId === inv.id
                                ? <Check className="w-4 h-4 text-emerald-400" />
                                : <Copy className="w-4 h-4" />
                              }
                            </button>
                            <button
                              onClick={() => revoke(inv.id)}
                              title={t('cancelInvite')}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
