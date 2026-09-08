'use client'

import { useState, useEffect, useCallback } from 'react'
import { Mail, Link, Plus, X, Copy, Check, Clock, UserCheck, Ban, RefreshCw, Users } from 'lucide-react'
import type { Invitation } from '@/types'

interface Props {
  callerRole: 'super_admin' | 'university_admin' | 'teacher'
  tenants: { id: string; name: string }[]
  groups:  { id: string; name: string }[]
}

const ROLE_OPTIONS: Record<string, { value: string; label: string }[]> = {
  super_admin:      [
    { value: 'university_admin', label: 'University Admin' },
    { value: 'center_manager',   label: 'Centre Manager' },
    { value: 'teacher',          label: 'Teacher' },
    { value: 'student',          label: 'Student' },
  ],
  university_admin: [
    { value: 'center_manager', label: 'Centre Manager' },
    { value: 'teacher', label: 'Teacher' },
    { value: 'student', label: 'Student' },
  ],
  teacher: [
    { value: 'student', label: 'Student' },
  ],
}

// Roles that MUST always use a private (email-specific) invitation.
// Staff roles are never handed out as a shareable public link.
const PRIVATE_ONLY_ROLES = new Set(['university_admin', 'center_manager'])

const STATUS_COLORS: Record<string, string> = {
  pending:   'text-accent bg-warning-subtle',
  accepted:  'text-accent bg-accent/10',
  revoked:   'text-fg-secondary bg-surface',
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
  const [invitations, setInvitations] = useState<InvitationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Form state
  const [isPublic, setIsPublic]       = useState(false)
  const [email, setEmail]             = useState('')
  const [role, setRole]               = useState(ROLE_OPTIONS[callerRole][0].value)
  const [tenantId, setTenantId]       = useState(tenants[0]?.id ?? '')
  const [groupId, setGroupId]         = useState('')
  const [expiresHours, setExpiresHours] = useState(48)
  const [maxUses, setMaxUses]         = useState<number | ''>('')
  const [formError, setFormError]     = useState('')
  const [creating, setCreating]       = useState(false)
  const [newLink, setNewLink]         = useState<string | null>(null)

  // When role changes to university_admin, force private
  const handleRoleChange = (newRole: string) => {
    setRole(newRole)
    setGroupId('')
    if (PRIVATE_ONLY_ROLES.has(newRole)) setIsPublic(false)
  }

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/invitations')
    const data = await res.json()
    setInvitations(data.invitations ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/invitations')
      .then(r => r.json())
      .then(data => {
        if (!cancelled) {
          setInvitations(data.invitations ?? [])
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

    const res = await fetch('/api/invitations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()

    if (!res.ok) {
      setFormError(data.error ?? 'Failed to create invitation')
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
          <h1 className="text-xl font-semibold text-fg">Invitations</h1>
          <p className="text-fg-secondary text-sm mt-1">
            Manage access invitations for your platform
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            className="p-2 rounded-lg text-fg-secondary hover:text-fg hover:bg-surface transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => { setShowForm(f => !f); setNewLink(null); setFormError('') }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-fg text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Invitation
          </button>
        </div>
      </div>

      {/* Create Form */}
      {showForm && (
        <div className="bg-surface border border-border rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-fg font-semibold flex items-center gap-2">
              {isPublic
                ? <><Link className="w-4 h-4 text-purple-400" /> Public Link</>
                : <><Mail className="w-4 h-4 text-accent" /> Private Invitation</>
              }
            </h2>
            <button onClick={() => setShowForm(false)} className="text-fg-muted hover:text-fg">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Link type toggle */}
          <div className="flex rounded-lg border border-border-strong overflow-hidden text-sm">
            <button
              type="button"
              onClick={() => setIsPublic(false)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 transition-colors ${
                !isPublic
                  ? 'bg-accent text-accent-fg'
                  : 'text-fg-secondary hover:text-fg hover:bg-surface'
              }`}
            >
              <Mail className="w-3.5 h-3.5" />
              Private (specific email)
            </button>
            <button
              type="button"
              onClick={() => canBePublic && setIsPublic(true)}
              disabled={!canBePublic}
              title={!canBePublic ? 'University Admin invitations must be email-specific' : undefined}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 transition-colors ${
                isPublic
                  ? 'bg-purple-600 text-fg'
                  : canBePublic
                    ? 'text-fg-secondary hover:text-fg hover:bg-surface'
                    : 'text-fg-muted cursor-not-allowed'
              }`}
            >
              <Link className="w-3.5 h-3.5" />
              Public link (anyone)
            </button>
          </div>

          {isPublic && (
            <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg px-4 py-3 text-purple-300 text-sm">
              Anyone with this link can register as a <strong>{role.replace('_', ' ')}</strong>.
              {role === 'student' && groupId && ' They will automatically join the selected group.'}
            </div>
          )}

          {newLink && (
            <div className="bg-accent-subtle border border-success/20 rounded-lg p-4 space-y-2">
              <p className="text-accent text-sm font-semibold">Invitation created!</p>
              <p className="text-fg-secondary text-xs">Share this link:</p>
              <div className="flex items-center gap-2 bg-canvas rounded-lg px-3 py-2">
                <code className="text-accent text-xs flex-1 break-all">{newLink}</code>
                <button
                  onClick={() => navigator.clipboard.writeText(newLink)}
                  className="text-fg-secondary hover:text-fg shrink-0"
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

          <form onSubmit={createInvitation} className="grid grid-cols-2 gap-4">

            {/* Email — only for private invitations */}
            {!isPublic && (
              <div className="col-span-2">
                <label className="block text-sm text-fg-secondary mb-1">Email Address</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  placeholder="invitee@university.edu"
                  className="w-full px-3 py-2 rounded-lg bg-surface border border-border-strong text-fg placeholder-fg-muted focus:outline-none focus:ring-2 focus:ring-accent text-sm"
                />
              </div>
            )}

            <div>
              <label className="block text-sm text-fg-secondary mb-1">Role</label>
              <select
                value={role}
                onChange={e => handleRoleChange(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-surface border border-border-strong text-fg focus:outline-none focus:ring-2 focus:ring-accent text-sm"
              >
                {ROLE_OPTIONS[callerRole].map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            {callerRole === 'super_admin' && (
              <div>
                <label className="block text-sm text-fg-secondary mb-1">University</label>
                <select
                  value={tenantId}
                  onChange={e => setTenantId(e.target.value)}
                  required
                  className="w-full px-3 py-2 rounded-lg bg-surface border border-border-strong text-fg focus:outline-none focus:ring-2 focus:ring-accent text-sm"
                >
                  {tenants.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
            )}

            {role === 'student' && groups.length > 0 && (
              <div>
                <label className="block text-sm text-fg-secondary mb-1">Group {isPublic ? '' : '(optional)'}</label>
                <select
                  value={groupId}
                  onChange={e => setGroupId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-surface border border-border-strong text-fg focus:outline-none focus:ring-2 focus:ring-accent text-sm"
                >
                  <option value="">No specific group</option>
                  {groups.map(g => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-sm text-fg-secondary mb-1">Expires in (hours)</label>
              <input
                type="number"
                value={expiresHours}
                onChange={e => setExpiresHours(Number(e.target.value))}
                min={1}
                max={720}
                className="w-full px-3 py-2 rounded-lg bg-surface border border-border-strong text-fg focus:outline-none focus:ring-2 focus:ring-accent text-sm"
              />
            </div>

            {/* Max uses — only for public links */}
            {isPublic && (
              <div>
                <label className="block text-sm text-fg-secondary mb-1">Max uses (blank = unlimited)</label>
                <input
                  type="number"
                  value={maxUses}
                  onChange={e => setMaxUses(e.target.value === '' ? '' : Number(e.target.value))}
                  min={1}
                  placeholder="Unlimited"
                  className="w-full px-3 py-2 rounded-lg bg-surface border border-border-strong text-fg placeholder-fg-muted focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
                />
              </div>
            )}

            <div className="col-span-2 flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-4 py-2 rounded-lg text-fg-secondary hover:text-fg hover:bg-surface text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creating}
                className={`px-4 py-2 rounded-lg text-fg text-sm font-medium transition-colors disabled:opacity-60 ${
                  isPublic
                    ? 'bg-purple-600 hover:bg-purple-500'
                    : 'bg-accent hover:bg-accent-hover'
                }`}
              >
                {creating ? 'Creating…' : isPublic ? 'Generate Public Link' : 'Send Invitation'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Invitations Table */}
      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : invitations.length === 0 ? (
          <div className="text-center py-16 space-y-2">
            <Mail className="w-10 h-10 text-fg-muted mx-auto" />
            <p className="text-fg-secondary text-sm">No invitations yet</p>
            <p className="text-fg-muted text-xs">Create one to invite users to your platform</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-5 py-3 text-fg-secondary font-medium">Email / Type</th>
                <th className="text-left px-5 py-3 text-fg-secondary font-medium">Role</th>
                {callerRole === 'super_admin' && (
                  <th className="text-left px-5 py-3 text-fg-secondary font-medium">University</th>
                )}
                <th className="text-left px-5 py-3 text-fg-secondary font-medium">Status</th>
                <th className="text-left px-5 py-3 text-fg-secondary font-medium">Uses / Expires</th>
                <th className="text-right px-5 py-3 text-fg-secondary font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {invitations.map(inv => {
                const expired = isExpired(inv)
                return (
                  <tr key={inv.id} className="hover:bg-surface/30 transition-colors">
                    <td className="px-5 py-3">
                      {inv.is_public ? (
                        <span className="inline-flex items-center gap-1.5 text-purple-400">
                          <Link className="w-3.5 h-3.5" />
                          Public link
                        </span>
                      ) : (
                        <span className="text-fg font-medium">{inv.email}</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <span className="capitalize text-fg-secondary">{inv.role.replace('_', ' ')}</span>
                    </td>
                    {callerRole === 'super_admin' && (
                      <td className="px-5 py-3 text-fg-secondary">
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
                        {expired ? 'expired' : resolvedStatus(inv)}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-fg-secondary text-xs space-y-0.5">
                      {inv.is_public && (
                        <div className="flex items-center gap-1 text-purple-400">
                          <Users className="w-3 h-3" />
                          {inv.use_count ?? 0}
                          {inv.max_uses != null ? ` / ${inv.max_uses}` : ' used'}
                        </div>
                      )}
                      <div>{new Date(inv.expires_at).toLocaleDateString()}</div>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {inv.status === 'pending' && !expired && (
                          <>
                            <button
                              onClick={() => copyLink(inv)}
                              title="Copy invitation link"
                              className="p-1.5 rounded-lg text-fg-secondary hover:text-fg hover:bg-canvas transition-colors"
                            >
                              {copiedId === inv.id
                                ? <Check className="w-4 h-4 text-accent" />
                                : <Copy className="w-4 h-4" />
                              }
                            </button>
                            <button
                              onClick={() => revoke(inv.id)}
                              title="Revoke invitation"
                              className="p-1.5 rounded-lg text-fg-secondary hover:text-red-400 hover:bg-red-500/10 transition-colors"
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
