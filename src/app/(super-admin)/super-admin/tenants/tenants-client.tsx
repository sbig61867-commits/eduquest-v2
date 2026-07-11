'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Plus, Building2, Archive, ArchiveRestore, Trash2, UserPlus, Mail } from 'lucide-react'
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

  const supabase = createClient()
  const router = useRouter()

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
    router.refresh()
  }

  async function toggleTenant(tenant: Tenant) {
    const archive = tenant.is_active // active -> archive (suspend); suspended -> restore
    if (archive && !confirm(`أرشفة جامعة "${tenant.name}"؟ سيُمنع كل مستخدميها من الدخول. البيانات تبقى محفوظة ويمكن استرجاعها لاحقاً.`)) return
    const res = await fetch('/api/admin/archive-tenant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant_id: tenant.id, archive }),
    })
    const data = await res.json()
    if (!res.ok) { alert(data.error ?? 'Failed to update university'); return }
    setTenants(prev => prev.map(t => t.id === tenant.id ? data.tenant : t))
    router.refresh()
  }

  async function deleteTenant(tenant: Tenant) {
    if (!confirm(`حذف نهائي لجامعة "${tenant.name}"؟\n\nسيُمحى كل شيء للأبد: المستخدمون وحساباتهم، المجموعات، الدروس، الاختبارات، والعلامات. لا يمكن التراجع.\n\nللإيقاف المؤقت استخدم "أرشفة" بدلاً من ذلك.`)) return
    if (!confirm(`تأكيد أخير: اكتب نعم في ذهنك — هذا حذف لا رجعة فيه لجامعة "${tenant.name}".`)) return
    const res = await fetch(`/api/admin/delete-tenant?id=${tenant.id}`, { method: 'DELETE' })
    const data = await res.json()
    if (!res.ok) { alert(data.error ?? 'Failed to delete university'); return }
    setTenants(prev => prev.filter(t => t.id !== tenant.id))
    // Invalidate the router cache so revisiting the page doesn't show the
    // deleted tenant from a stale server render.
    router.refresh()
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
                  {tenant.is_active ? 'نشطة' : 'مؤرشفة'}
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
                {/* Invite admin via link — redirects to the Invitations page */}
                <Button variant="secondary" size="sm" className="w-full !bg-blue-600/10 !border-blue-500/20 !text-blue-400 hover:!bg-blue-600/20" onClick={() => router.push('/super-admin/invitations')}>
                  <Mail className="w-4 h-4" /> Invite Admin (link)
                </Button>
                <div className="flex gap-2">
                  <Button
                    variant="ghost" size="sm"
                    onClick={() => toggleTenant(tenant)}
                    className={`flex-1 ${tenant.is_active ? 'hover:text-amber-400 hover:bg-amber-500/10' : 'hover:text-emerald-400 hover:bg-emerald-500/10'}`}
                  >
                    {tenant.is_active
                      ? <><Archive className="w-4 h-4" /> أرشفة</>
                      : <><ArchiveRestore className="w-4 h-4" /> استرجاع</>}
                  </Button>
                  <Button
                    variant="ghost" size="sm"
                    onClick={() => deleteTenant(tenant)}
                    title="حذف نهائي"
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

    </div>
  )
}
