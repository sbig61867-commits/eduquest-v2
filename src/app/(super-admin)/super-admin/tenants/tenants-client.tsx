'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Plus, Building2, ToggleLeft, Trash2, UserPlus, Link, Copy, Check } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import type { Tenant } from '@/types'

interface Props { initialTenants: Tenant[] }

export function TenantsClient({ initialTenants }: Props) {
  const [tenants, setTenants] = useState(initialTenants)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', slug: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Manual add admin modal
  const [adminTarget, setAdminTarget] = useState<Tenant | null>(null)
  const [adminForm, setAdminForm] = useState({ full_name: '', email: '', password: '' })
  const [adminLoading, setAdminLoading] = useState(false)
  const [adminError, setAdminError] = useState('')
  const [adminSuccess, setAdminSuccess] = useState('')

  // Invite admin via link modal
  const [inviteTarget, setInviteTarget] = useState<Tenant | null>(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const supabase = createClient()

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const slug = form.slug || form.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    const { data, error: err } = await supabase
      .from('tenants')
      .insert({ name: form.name, slug })
      .select()
      .single()
    if (err) { setError(err.message); setLoading(false); return }
    setTenants(prev => [data, ...prev])
    setForm({ name: '', slug: '' })
    setShowAdd(false)
    setLoading(false)
  }

  async function toggleTenant(tenant: Tenant) {
    const { data } = await supabase
      .from('tenants').update({ is_active: !tenant.is_active }).eq('id', tenant.id).select().single()
    if (data) setTenants(prev => prev.map(t => t.id === tenant.id ? data : t))
  }

  async function deleteTenant(id: string) {
    if (!confirm('Delete this university? ALL data including users, lessons, and exams will be permanently removed.')) return
    await supabase.from('tenants').delete().eq('id', id)
    setTenants(prev => prev.filter(t => t.id !== id))
  }

  // ── Manual add admin ──────────────────────────────────────
  function openAddAdmin(tenant: Tenant) {
    setAdminTarget(tenant)
    setAdminForm({ full_name: '', email: '', password: '' })
    setAdminError('')
    setAdminSuccess('')
  }

  async function handleAddAdmin(e: React.FormEvent) {
    e.preventDefault()
    if (!adminTarget) return
    setAdminLoading(true)
    setAdminError('')
    setAdminSuccess('')

    const res = await fetch('/api/admin/create-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...adminForm,
        role: 'university_admin',
        tenant_id: adminTarget.id,
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      setAdminError(data.error ?? 'Failed to create admin')
    } else {
      setAdminSuccess(`✓ Admin "${data.user.full_name}" created — they can now log in with ${adminForm.email}`)
      setAdminForm({ full_name: '', email: '', password: '' })
    }
    setAdminLoading(false)
  }

  // ── Invite admin via link ─────────────────────────────────
  function openInvite(tenant: Tenant) {
    setInviteTarget(tenant)
    setInviteEmail('')
    setInviteError('')
    setInviteLink(null)
    setCopied(false)
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    if (!inviteTarget) return
    setInviteLoading(true)
    setInviteError('')
    setInviteLink(null)

    const res = await fetch('/api/invitations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: inviteEmail,
        role: 'university_admin',
        tenant_id: inviteTarget.id,
        expires_hours: 72,
        is_public: false,
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      setInviteError(data.error ?? 'Failed to create invitation')
    } else {
      setInviteLink(data.joinUrl)
      setInviteEmail('')
    }
    setInviteLoading(false)
  }

  async function copyLink() {
    if (!inviteLink) return
    await navigator.clipboard.writeText(inviteLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Universities</h2>
          <p className="text-slate-400 mt-1">{tenants.length} tenants registered</p>
        </div>
        <Button onClick={() => setShowAdd(true)}><Plus className="w-4 h-4" /> New University</Button>
      </div>

      {tenants.length === 0 ? (
        <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl">
          <Building2 className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400 mb-2">No universities yet.</p>
          <p className="text-slate-500 text-sm">Add the first university to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {tenants.map(tenant => (
            <div key={tenant.id} className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition-colors">
              <div className="flex items-start justify-between mb-4">
                <div className="w-10 h-10 rounded-xl bg-blue-600/20 flex items-center justify-center">
                  <Building2 className="w-5 h-5 text-blue-400" />
                </div>
                <Badge variant={tenant.is_active ? 'green' : 'red'}>
                  {tenant.is_active ? 'Active' : 'Suspended'}
                </Badge>
              </div>
              <h3 className="text-white font-semibold text-lg mb-1">{tenant.name}</h3>
              <p className="text-slate-500 text-sm mb-1 font-mono">{tenant.slug}</p>
              <p className="text-slate-500 text-xs mb-4">Created {formatDate(tenant.created_at)}</p>

              <div className="space-y-2 pt-3 border-t border-slate-800">
                {/* Add admin manually */}
                <Button variant="secondary" size="sm" className="w-full" onClick={() => openAddAdmin(tenant)}>
                  <UserPlus className="w-4 h-4" /> Add Admin (manual)
                </Button>
                {/* Invite admin via link */}
                <Button variant="secondary" size="sm" className="w-full !bg-blue-600/10 !border-blue-500/20 !text-blue-400 hover:!bg-blue-600/20" onClick={() => openInvite(tenant)}>
                  <Link className="w-4 h-4" /> Invite Admin (link)
                </Button>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => toggleTenant(tenant)} className="flex-1">
                    <ToggleLeft className="w-4 h-4" />
                    {tenant.is_active ? 'Suspend' : 'Activate'}
                  </Button>
                  <Button
                    variant="ghost" size="sm"
                    onClick={() => deleteTenant(tenant.id)}
                    className="hover:text-red-400 hover:bg-red-500/10"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create University Modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add New University">
        <form onSubmit={handleAdd} className="space-y-4">
          {error && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
          <Input
            label="University Name"
            value={form.name}
            onChange={e => {
              const name = e.target.value
              setForm({ name, slug: name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') })
            }}
            required
            placeholder="King Abdullah University"
          />
          <Input
            label="Slug (URL identifier)"
            value={form.slug}
            onChange={e => setForm(p => ({ ...p, slug: e.target.value }))}
            required
            placeholder="king-abdullah-university"
          />
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setShowAdd(false)} className="flex-1">Cancel</Button>
            <Button type="submit" loading={loading} className="flex-1">Create University</Button>
          </div>
        </form>
      </Modal>

      {/* Manual Add Admin Modal */}
      <Modal open={!!adminTarget} onClose={() => setAdminTarget(null)} title={`Add Admin — ${adminTarget?.name ?? ''}`}>
        <form onSubmit={handleAddAdmin} className="space-y-4">
          {adminError && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{adminError}</p>}
          {adminSuccess && <p className="text-emerald-400 text-sm bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">{adminSuccess}</p>}
          <p className="text-slate-400 text-sm">
            This admin will manage teachers and students for <span className="text-white font-medium">{adminTarget?.name}</span>.
          </p>
          <Input label="Full Name" value={adminForm.full_name} onChange={e => setAdminForm(p => ({ ...p, full_name: e.target.value }))} required placeholder="Dr. Mohammed Ali" />
          <Input label="Email" type="email" value={adminForm.email} onChange={e => setAdminForm(p => ({ ...p, email: e.target.value }))} required placeholder="admin@university.edu" />
          <Input label="Password" type="password" value={adminForm.password} onChange={e => setAdminForm(p => ({ ...p, password: e.target.value }))} required placeholder="Min 8 characters" />
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setAdminTarget(null)} className="flex-1">Close</Button>
            <Button type="submit" loading={adminLoading} className="flex-1">Create Admin</Button>
          </div>
        </form>
      </Modal>

      {/* Invite Admin via Link Modal */}
      <Modal open={!!inviteTarget} onClose={() => setInviteTarget(null)} title={`Invite Admin — ${inviteTarget?.name ?? ''}`}>
        <div className="space-y-4">
          <p className="text-slate-400 text-sm">
            Enter the admin&apos;s email. They will receive a unique link to register and will automatically get access to{' '}
            <span className="text-white font-medium">{inviteTarget?.name}</span>.
          </p>

          {inviteLink ? (
            <div className="space-y-3">
              <p className="text-emerald-400 text-sm font-medium">✓ Invitation link created! Valid for 72 hours.</p>
              <div className="flex items-center gap-2 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5">
                <code className="text-blue-300 text-xs flex-1 break-all">{inviteLink}</code>
                <button onClick={copyLink} className="text-slate-400 hover:text-white shrink-0 ml-1">
                  {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-slate-500 text-xs">Send this link to the admin. It can only be used once.</p>
              <div className="flex gap-3 pt-1">
                <Button variant="secondary" className="flex-1" onClick={() => { setInviteLink(null); setInviteEmail('') }}>
                  Create Another
                </Button>
                <Button className="flex-1" onClick={() => setInviteTarget(null)}>Done</Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleInvite} className="space-y-4">
              {inviteError && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{inviteError}</p>}
              <Input
                label="Admin Email"
                type="email"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                required
                placeholder="admin@university.edu"
              />
              <div className="flex gap-3 pt-1">
                <Button type="button" variant="secondary" onClick={() => setInviteTarget(null)} className="flex-1">Cancel</Button>
                <Button type="submit" loading={inviteLoading} className="flex-1">Generate Link</Button>
              </div>
            </form>
          )}
        </div>
      </Modal>
    </div>
  )
}
