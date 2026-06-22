'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { UserPlus, Search, Trash2, ToggleLeft, Mail } from 'lucide-react'
import { formatDate } from '@/lib/utils'

interface User {
  id: string
  full_name: string
  email: string
  role: string
  is_active: boolean
  created_at: string
  tenants: { name: string } | null
}

interface Tenant { id: string; name: string }

interface Props {
  initialUsers: User[]
  tenants: Tenant[]
}

const ROLES = [
  { value: 'university_admin', label: 'University Admin' },
  { value: 'teacher', label: 'Teacher' },
  { value: 'student', label: 'Student' },
]

const roleColors: Record<string, 'blue' | 'green' | 'yellow' | 'gray'> = {
  super_admin: 'blue',
  university_admin: 'green',
  teacher: 'yellow',
  student: 'gray',
}

export function SuperUsersClient({ initialUsers, tenants }: Props) {
  const [users, setUsers] = useState(initialUsers)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ full_name: '', email: '', password: '', role: 'university_admin', tenant_id: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const filtered = users.filter(u => {
    const matchSearch = u.full_name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
    const matchRole = roleFilter === 'all' || u.role === roleFilter
    return matchSearch && matchRole
  })

  function openAdd(prefilledTenantId?: string, prefilledRole?: string) {
    setForm({
      full_name: '', email: '', password: '',
      role: prefilledRole ?? 'university_admin',
      tenant_id: prefilledTenantId ?? (tenants[0]?.id ?? ''),
    })
    setError('')
    setShowAdd(true)
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const res = await fetch('/api/admin/create-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Failed to create user'); setLoading(false); return }

    // Attach tenant name for display
    const tenant = tenants.find(t => t.id === form.tenant_id)
    setUsers(prev => [{ ...data.user, tenants: tenant ? { name: tenant.name } : null }, ...prev])
    setShowAdd(false)
    setLoading(false)
  }

  async function toggleUser(u: User) {
    const res = await fetch('/api/admin/create-user', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: u.id, is_active: !u.is_active }),
    })
    if (res.ok) {
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, is_active: !x.is_active } : x))
    }
  }

  async function deleteUser(id: string) {
    if (!confirm('Delete this user permanently?')) return
    await fetch(`/api/admin/delete-user?id=${id}`, { method: 'DELETE' })
    setUsers(prev => prev.filter(u => u.id !== id))
  }

  const roleNeedsUniversity = form.role !== 'super_admin'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">All Users</h2>
          <p className="text-slate-400 mt-1">{users.length} users across all universities</p>
        </div>
        <Button onClick={() => openAdd()}>
          <UserPlus className="w-4 h-4" /> Add User
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or email..."
            className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-slate-900 border border-slate-800 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
        </div>
        <select
          value={roleFilter}
          onChange={e => setRoleFilter(e.target.value)}
          className="px-4 py-2.5 rounded-lg bg-slate-900 border border-slate-800 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">All Roles</option>
          <option value="super_admin">Super Admin</option>
          <option value="university_admin">University Admin</option>
          <option value="teacher">Teacher</option>
          <option value="student">Student</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3">User</th>
              <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3 hidden md:table-cell">University</th>
              <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3">Role</th>
              <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3 hidden lg:table-cell">Joined</th>
              <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3">Status</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="text-center text-slate-500 py-12">No users found</td></tr>
            )}
            {filtered.map(u => (
              <tr key={u.id} className="hover:bg-slate-800/50 transition-colors">
                <td className="px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-bold shrink-0">
                      {u.full_name[0]?.toUpperCase()}
                    </div>
                    <div>
                      <p className="text-white text-sm font-medium">{u.full_name}</p>
                      <p className="text-slate-500 text-xs flex items-center gap-1"><Mail className="w-3 h-3" />{u.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-5 py-4 hidden md:table-cell">
                  <span className="text-slate-400 text-sm">{u.tenants?.name ?? <span className="text-slate-600">—</span>}</span>
                </td>
                <td className="px-5 py-4">
                  <Badge variant={roleColors[u.role] ?? 'gray'}>
                    {u.role.replace(/_/g, ' ')}
                  </Badge>
                </td>
                <td className="px-5 py-4 hidden lg:table-cell">
                  <span className="text-slate-400 text-sm">{formatDate(u.created_at)}</span>
                </td>
                <td className="px-5 py-4">
                  <Badge variant={u.is_active ? 'green' : 'red'}>
                    {u.is_active ? 'Active' : 'Disabled'}
                  </Badge>
                </td>
                <td className="px-5 py-4">
                  <div className="flex items-center gap-1 justify-end">
                    <Button variant="ghost" size="sm" onClick={() => toggleUser(u)} title={u.is_active ? 'Disable' : 'Enable'}>
                      <ToggleLeft className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost" size="sm"
                      onClick={() => deleteUser(u.id)}
                      className="hover:text-red-400 hover:bg-red-500/10"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add User Modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add New User">
        <form onSubmit={handleAdd} className="space-y-4">
          {error && (
            <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
          )}

          <Input
            label="Full Name"
            value={form.full_name}
            onChange={e => setForm(p => ({ ...p, full_name: e.target.value }))}
            required
            placeholder="Ahmed Hassan"
          />
          <Input
            label="Email"
            type="email"
            value={form.email}
            onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
            required
            placeholder="user@university.edu"
          />
          <Input
            label="Password"
            type="password"
            value={form.password}
            onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
            required
            placeholder="Min 8 characters"
          />

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-300">Role</label>
            <select
              value={form.role}
              onChange={e => setForm(p => ({ ...p, role: e.target.value }))}
              className="w-full px-4 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {ROLES.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>

          {roleNeedsUniversity && (
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-300">University</label>
              <select
                value={form.tenant_id}
                onChange={e => setForm(p => ({ ...p, tenant_id: e.target.value }))}
                required
                className="w-full px-4 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— Select university —</option>
                {tenants.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setShowAdd(false)} className="flex-1">Cancel</Button>
            <Button type="submit" loading={loading} className="flex-1">Create User</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
