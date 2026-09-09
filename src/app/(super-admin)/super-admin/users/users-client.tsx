'use client'
import { confirmDialog } from '@/lib/confirm-dialog'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Modal } from '@/components/ui/modal'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import {
  UserPlus, Search, Trash2, ToggleLeft, Mail,
  Building2, ChevronRight, Users, GraduationCap,
  ShieldCheck, ArrowLeft, ToggleRight, ChevronLeft,
} from 'lucide-react'
import { formatDate, getRoleLabel } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface User {
  id: string
  full_name: string
  email: string
  role: string
  is_active: boolean
  created_at: string
  tenant_id: string | null
}

interface Tenant {
  id: string
  name: string
  slug: string
  is_active: boolean
  created_at: string
}

interface TenantCounts {
  admins: number
  teachers: number
  students: number
}

interface Props {
  tenants: Tenant[]
  superAdmins: User[]
  tenantCounts: Record<string, TenantCounts>
}

const roleColors: Record<string, 'info' | 'success' | 'warning' | 'neutral' | 'error'> = {
  super_admin:      'info',
  university_admin: 'success',
  teacher:          'warning',
  student:          'neutral',
}

function Avatar({ name, color = 'info' }: { name: string; color?: string }) {
  const colors: Record<string, string> = {
    blue: 'bg-accent', green: 'bg-accent', yellow: 'bg-warning', gray: 'bg-border-strong',
  }
  return (
    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-fg text-sm font-bold shrink-0 ${colors[color] ?? colors.blue}`}>
      {name?.[0]?.toUpperCase() ?? '?'}
    </div>
  )
}

// ── User Row ──────────────────────────────────────────────────────────────────

function UserRow({ u, onToggle, onDelete }: {
  u: User
  onToggle: (u: User) => void
  onDelete: (id: string) => void
}) {
  return (
    <tr className="hover:bg-surface/50 transition-colors">
      <td className="px-5 py-4">
        <div className="flex items-center gap-3">
          <Avatar name={u.full_name} color={roleColors[u.role]} />
          <div>
            <p className="text-fg text-sm font-medium">{u.full_name}</p>
            <p className="text-fg-muted text-xs flex items-center gap-1">
              <Mail className="w-3 h-3" />{u.email}
            </p>
          </div>
        </div>
      </td>
      <td className="px-5 py-4">
        <Badge variant={roleColors[u.role] ?? 'neutral'}>{getRoleLabel(u.role as Parameters<typeof getRoleLabel>[0])}</Badge>
      </td>
      <td className="px-5 py-4 hidden lg:table-cell">
        <span className="text-fg-secondary text-sm">{formatDate(u.created_at)}</span>
      </td>
      <td className="px-5 py-4">
        <Badge variant={u.is_active ? 'success' : 'error'}>{u.is_active ? 'Active' : 'Disabled'}</Badge>
      </td>
      <td className="px-5 py-4">
        <div className="flex items-center gap-1 justify-end">
          <Button variant="ghost" size="sm" onClick={() => onToggle(u)} title={u.is_active ? 'Disable' : 'Enable'}>
            {u.is_active
              ? <ToggleRight className="w-4 h-4 text-accent" />
              : <ToggleLeft  className="w-4 h-4 text-fg-muted"  />}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onDelete(u.id)}
            className="hover:text-error hover:bg-error-subtle">
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </td>
    </tr>
  )
}

// ── Pagination ────────────────────────────────────────────────────────────────

function Pagination({ page, total, pageSize, onChange }: {
  page: number; total: number; pageSize: number; onChange: (p: number) => void
}) {
  const totalPages = Math.ceil(total / pageSize)
  if (totalPages <= 1) return null
  return (
    <div className="flex items-center justify-between pt-2">
      <p className="text-fg-muted text-sm">{total} users · page {page} of {totalPages}</p>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => onChange(page - 1)} disabled={page <= 1}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
          // sliding window around current page
          const start = Math.max(1, Math.min(page - 2, totalPages - 4))
          const p = start + i
          return (
            <button key={p} onClick={() => onChange(p)}
              className={`w-8 h-8 rounded text-sm transition-colors ${
                p === page ? 'bg-accent text-fg' : 'text-fg-secondary hover:text-fg hover:bg-surface'
              }`}>
              {p}
            </button>
          )
        })}
        <Button variant="ghost" size="sm" onClick={() => onChange(page + 1)} disabled={page >= totalPages}>
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  )
}

// ── Add User Modal ────────────────────────────────────────────────────────────

const ROLES = [
  { value: 'university_admin', label: 'University Admin' },
  { value: 'teacher',          label: 'Teacher' },
  { value: 'student',          label: 'Student' },
]

function AddUserModal({ open, onClose, tenants, defaultTenantId, onCreated }: {
  open: boolean
  onClose: () => void
  tenants: Tenant[]
  defaultTenantId?: string
  onCreated: (user: User) => void
}) {
  const [form, setForm] = useState({
    full_name: '', email: '', password: '',
    role: 'university_admin',
    tenant_id: defaultTenantId ?? tenants[0]?.id ?? '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError('')
    const res = await fetch('/api/admin/create-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Failed'); setLoading(false); return }
    onCreated(data.user)
    setForm({ full_name: '', email: '', password: '', role: 'university_admin', tenant_id: defaultTenantId ?? tenants[0]?.id ?? '' })
    onClose()
    setLoading(false)
  }

  return (
    <Modal open={open} onClose={onClose} title="Add New User">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <p className="text-error text-sm bg-error-subtle border border-error/25 rounded-lg px-3 py-2">{error}</p>
        )}
        <Input label="Full Name" value={form.full_name} onChange={e => setForm(p => ({ ...p, full_name: e.target.value }))} required placeholder="Ahmed Hassan" />
        <Input label="Email" type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} required placeholder="user@university.edu" />
        <Input label="Password" type="password" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} required placeholder="Min 8 characters" />
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-fg-secondary">Role</label>
          <select value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}
            className="w-full px-4 py-2.5 rounded-lg bg-surface border border-border-strong text-fg text-sm focus:outline-none focus:ring-2 focus:ring-accent">
            {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        {!defaultTenantId && (
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-fg-secondary">University</label>
            <select value={form.tenant_id} onChange={e => setForm(p => ({ ...p, tenant_id: e.target.value }))} required
              className="w-full px-4 py-2.5 rounded-lg bg-surface border border-border-strong text-fg text-sm focus:outline-none focus:ring-2 focus:ring-accent">
              <option value="">— Select university —</option>
              {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        )}
        <div className="flex gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
          <Button type="submit" loading={loading} className="flex-1">Create User</Button>
        </div>
      </form>
    </Modal>
  )
}

// ── University Detail View (lazy-loaded, paginated) ───────────────────────────

type TabKey = 'admins' | 'teachers' | 'students'
const TAB_ROLES: Record<TabKey, string> = {
  admins: 'university_admin', teachers: 'teacher', students: 'student',
}

function UniversityView({ tenant, tenants, onBack, initialCounts }: {
  tenant: Tenant
  tenants: Tenant[]
  onBack: () => void
  initialCounts: TenantCounts
}) {
  const router    = useRouter()
  const [tab,     setTab]    = useState<TabKey>('admins')
  const [search,  setSearch] = useState('')
  const [page,    setPage]   = useState(1)
  const [users,   setUsers]  = useState<User[]>([])
  const [total,   setTotal]  = useState(0)
  const [loading, setLoading] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  // Optimistic counts for the stat cards
  const [counts, setCounts]   = useState(initialCounts)
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchUsers = useCallback(async (p: number, s: string, t: TabKey) => {
    setLoading(true)
    const params = new URLSearchParams({
      tenant_id: tenant.id,
      role: TAB_ROLES[t],
      page: String(p),
      ...(s ? { search: s } : {}),
    })
    const res = await fetch(`/api/admin/tenant-users?${params}`)
    const data = await res.json()
    if (res.ok) { setUsers(data.users); setTotal(data.total) }
    else toast.error(data.error ?? 'Failed to load users')
    setLoading(false)
  }, [tenant.id])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetchUsers is a useCallback fetch handler; setLoading(true) fires before the first await, which is intentional
  useEffect(() => { fetchUsers(1, '', 'admins') }, [fetchUsers])

  function changeTab(t: TabKey) {
    setTab(t); setPage(1); setSearch(''); fetchUsers(1, '', t)
  }

  function handleSearch(s: string) {
    setSearch(s)
    if (searchDebounce.current) clearTimeout(searchDebounce.current)
    searchDebounce.current = setTimeout(() => { setPage(1); fetchUsers(1, s, tab) }, 350)
  }

  function changePage(p: number) { setPage(p); fetchUsers(p, search, tab) }

  async function toggleUser(u: User) {
    const res = await fetch('/api/admin/toggle-user', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: u.id, isActive: !u.is_active }),
    })
    if (res.ok) { setUsers(prev => prev.map(x => x.id === u.id ? { ...x, is_active: !x.is_active } : x)); router.refresh() }
  }

  async function deleteUser(id: string) {
    if (!(await confirmDialog('Delete this user permanently?'))) return
    const res = await fetch(`/api/admin/delete-user?id=${id}`, { method: 'DELETE' })
    if (!res.ok) { toast.error((await res.json().catch(() => ({}))).error ?? 'فشل الحذف'); return }
    setUsers(prev => prev.filter(u => u.id !== id))
    setTotal(prev => prev - 1)
    setCounts(prev => ({
      ...prev,
      admins:   tab === 'admins'   ? prev.admins   - 1 : prev.admins,
      teachers: tab === 'teachers' ? prev.teachers - 1 : prev.teachers,
      students: tab === 'students' ? prev.students - 1 : prev.students,
    }))
    router.refresh()
  }

  function handleUserCreated(user: User) {
    const role = user.role as TabKey
    const tabForRole = Object.entries(TAB_ROLES).find(([, r]) => r === user.role)?.[0] as TabKey | undefined
    if (tabForRole) setCounts(prev => ({ ...prev, [tabForRole]: (prev[tabForRole] ?? 0) + 1 }))
    // Re-fetch current tab so the new user appears if same role
    if (tabForRole === tab) fetchUsers(1, search, tab)
    void role
  }

  const tabs = [
    { key: 'admins'   as const, label: 'Admins',   count: counts.admins,   icon: ShieldCheck,   color: 'text-accent' },
    { key: 'teachers' as const, label: 'Teachers',  count: counts.teachers, icon: GraduationCap, color: 'text-accent'   },
    { key: 'students' as const, label: 'Students',  count: counts.students, icon: Users,         color: 'text-accent'    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={onBack} aria-label="Back to all users" className="p-2 rounded-lg hover:bg-surface text-fg-secondary hover:text-fg transition-colors">
          <ArrowLeft className="w-5 h-5" aria-hidden="true" />
        </button>
        <div className="w-10 h-10 rounded-lg bg-accent-subtle flex items-center justify-center shrink-0">
          <Building2 className="w-5 h-5 text-accent" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold text-fg">{tenant.name}</h2>
          <p className="text-fg-secondary text-sm">
            {counts.admins + counts.teachers + counts.students} users total · {tenant.slug}
          </p>
        </div>
        <Badge variant={tenant.is_active ? 'success' : 'error'}>{tenant.is_active ? 'Active' : 'Frozen'}</Badge>
        <Button onClick={() => setShowAdd(true)}>
          <UserPlus className="w-4 h-4" /> Add User
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {tabs.map(t => (
          <button key={t.key} onClick={() => changeTab(t.key)}
            className={`p-4 rounded-lg border text-left transition-colors ${
              tab === t.key ? 'bg-surface border-border-strong' : 'bg-surface border-border hover:border-border-strong'
            }`}>
            <t.icon className={`w-5 h-5 mb-2 ${t.color}`} />
            <p className="text-xl font-semibold text-fg">{t.count}</p>
            <p className="text-fg-secondary text-sm">{t.label}</p>
          </button>
        ))}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-muted" />
        <input value={search} onChange={e => handleSearch(e.target.value)}
          placeholder={`Search ${tab}...`}
          className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-surface border border-border text-fg placeholder-fg-muted focus:outline-none focus:ring-2 focus:ring-accent text-sm" />
      </div>

      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left text-xs font-medium text-fg-secondary uppercase tracking-wider px-5 py-3">User</th>
              <th className="text-left text-xs font-medium text-fg-secondary uppercase tracking-wider px-5 py-3">Role</th>
              <th className="text-left text-xs font-medium text-fg-secondary uppercase tracking-wider px-5 py-3 hidden lg:table-cell">Joined</th>
              <th className="text-left text-xs font-medium text-fg-secondary uppercase tracking-wider px-5 py-3">Status</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr><td colSpan={5} className="text-center text-fg-muted py-12 text-sm">Loading…</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={5} className="text-center text-fg-muted py-12 text-sm">No {tab} found</td></tr>
            ) : (
              users.map(u => <UserRow key={u.id} u={u} onToggle={toggleUser} onDelete={deleteUser} />)
            )}
          </tbody>
        </table>
      </div>

      <Pagination page={page} total={total} pageSize={50} onChange={changePage} />

      <AddUserModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        tenants={tenants}
        defaultTenantId={tenant.id}
        onCreated={handleUserCreated}
      />
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export function SuperUsersClient({ tenants, superAdmins, tenantCounts }: Props) {
  const router = useRouter()
  const [localSuperAdmins, setLocalSuperAdmins] = useState(superAdmins)
  const [selectedTenant,   setSelectedTenant]   = useState<Tenant | null>(null)
  const [search,           setSearch]           = useState('')
  const [showAdd,          setShowAdd]          = useState(false)

  async function toggleSuperAdmin(u: User) {
    const res = await fetch('/api/admin/toggle-user', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: u.id, isActive: !u.is_active }),
    })
    if (res.ok) {
      setLocalSuperAdmins(prev => prev.map(x => x.id === u.id ? { ...x, is_active: !x.is_active } : x))
      router.refresh()
    }
  }

  async function deleteSuperAdmin(id: string) {
    if (!(await confirmDialog('Delete this user permanently?'))) return
    const res = await fetch(`/api/admin/delete-user?id=${id}`, { method: 'DELETE' })
    if (!res.ok) { toast.error((await res.json().catch(() => ({}))).error ?? 'فشل الحذف'); return }
    setLocalSuperAdmins(prev => prev.filter(u => u.id !== id))
    router.refresh()
  }

  function handleSuperAdminCreated(user: User) {
    setLocalSuperAdmins(prev => [user, ...prev])
  }

  if (selectedTenant) {
    return (
      <UniversityView
        tenant={selectedTenant}
        tenants={tenants}
        onBack={() => setSelectedTenant(null)}
        initialCounts={tenantCounts[selectedTenant.id] ?? { admins: 0, teachers: 0, students: 0 }}
      />
    )
  }

  const totalUsers = Object.values(tenantCounts).reduce(
    (sum, c) => sum + c.admins + c.teachers + c.students, 0
  ) + localSuperAdmins.length

  const filteredTenants = tenants.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.slug.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-fg">All Users</h2>
          <p className="text-fg-secondary mt-1">{tenants.length} universities · {totalUsers} total users</p>
        </div>
        <Button onClick={() => setShowAdd(true)}>
          <UserPlus className="w-4 h-4" /> Add User
        </Button>
      </div>

      {localSuperAdmins.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-fg-secondary uppercase tracking-wider">Platform Administrators</h3>
          <div className="bg-surface border border-blue-900/40 rounded-lg overflow-hidden">
            <table className="w-full">
              <tbody className="divide-y divide-border">
                {localSuperAdmins.map(u => (
                  <UserRow key={u.id} u={u} onToggle={toggleSuperAdmin} onDelete={deleteSuperAdmin} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-fg-secondary uppercase tracking-wider">Universities</h3>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-fg-muted" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search universities..."
              className="pl-9 pr-4 py-2 rounded-lg bg-surface border border-border text-fg placeholder-fg-muted focus:outline-none focus:ring-2 focus:ring-accent text-sm w-56" />
          </div>
        </div>

        {filteredTenants.length === 0 ? (
          <div className="text-center py-16 bg-surface border border-border rounded-lg">
            <Building2 className="w-10 h-10 text-fg-muted mx-auto mb-3" />
            <p className="text-fg-secondary">No universities found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredTenants.map(tenant => {
              const c = tenantCounts[tenant.id] ?? { admins: 0, teachers: 0, students: 0 }
              return (
                <button key={tenant.id} onClick={() => setSelectedTenant(tenant)}
                  className="group bg-surface border border-border hover:border-border-strong rounded-lg p-5 text-left transition-all hover:shadow-lg hover:shadow-black/20">
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-11 h-11 rounded-lg bg-accent-subtle flex items-center justify-center shrink-0">
                      <Building2 className="w-5 h-5 text-accent" />
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={tenant.is_active ? 'success' : 'error'}>{tenant.is_active ? 'Active' : 'Frozen'}</Badge>
                      <ChevronRight className="w-4 h-4 text-fg-muted group-hover:text-fg-secondary group-hover:translate-x-0.5 transition-all" />
                    </div>
                  </div>
                  <h3 className="text-fg font-semibold mb-0.5 group-hover:text-accent-hover transition-colors">{tenant.name}</h3>
                  <p className="text-fg-muted text-xs mb-4">{tenant.slug}</p>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-surface/60 rounded-lg p-2 text-center">
                      <ShieldCheck className="w-3.5 h-3.5 text-accent mx-auto mb-1" />
                      <p className="text-fg text-sm font-bold">{c.admins}</p>
                      <p className="text-fg-muted text-xs">Admins</p>
                    </div>
                    <div className="bg-surface/60 rounded-lg p-2 text-center">
                      <GraduationCap className="w-3.5 h-3.5 text-accent mx-auto mb-1" />
                      <p className="text-fg text-sm font-bold">{c.teachers}</p>
                      <p className="text-fg-muted text-xs">Teachers</p>
                    </div>
                    <div className="bg-surface/60 rounded-lg p-2 text-center">
                      <Users className="w-3.5 h-3.5 text-accent mx-auto mb-1" />
                      <p className="text-fg text-sm font-bold">{c.students}</p>
                      <p className="text-fg-muted text-xs">Students</p>
                    </div>
                  </div>
                  <p className="text-fg-muted text-xs mt-3">Created {formatDate(tenant.created_at)}</p>
                </button>
              )
            })}
          </div>
        )}
      </div>

      <AddUserModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        tenants={tenants}
        onCreated={handleSuperAdminCreated}
      />
    </div>
  )
}
