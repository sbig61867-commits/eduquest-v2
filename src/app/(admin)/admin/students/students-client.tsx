'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { UserPlus, Search, Trash2, ToggleLeft, Mail } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import type { User } from '@/types'

interface Props { initialStudents: User[] }

export function StudentsClient({ initialStudents }: Props) {
  const [students, setStudents] = useState(initialStudents)
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ full_name: '', email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const supabase = createClient()

  const filtered = students.filter(s =>
    s.full_name.toLowerCase().includes(search.toLowerCase()) ||
    s.email.toLowerCase().includes(search.toLowerCase())
  )

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await fetch('/api/admin/create-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, role: 'student' }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error); setLoading(false); return }
    setStudents(prev => [data.user, ...prev])
    setForm({ full_name: '', email: '', password: '' })
    setShowAdd(false)
    setLoading(false)
  }

  async function toggleStatus(student: User) {
    const { error } = await supabase.from('users').update({ is_active: !student.is_active }).eq('id', student.id)
    if (!error) setStudents(prev => prev.map(s => s.id === student.id ? { ...s, is_active: !s.is_active } : s))
  }

  async function deleteStudent(id: string) {
    if (!confirm('Remove this student?')) return
    await fetch(`/api/admin/delete-user?id=${id}`, { method: 'DELETE' })
    setStudents(prev => prev.filter(s => s.id !== id))
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Students</h2>
          <p className="text-slate-400 mt-1">{students.length} total students</p>
        </div>
        <Button onClick={() => setShowAdd(true)}><UserPlus className="w-4 h-4" /> Add Student</Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search students..." className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-slate-900 border border-slate-800 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3">Name</th>
              <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3 hidden md:table-cell">Email</th>
              <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3 hidden lg:table-cell">Joined</th>
              <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3">Status</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {filtered.length === 0 && <tr><td colSpan={5} className="text-center text-slate-500 py-10">No students found</td></tr>}
            {filtered.map(student => (
              <tr key={student.id} className="hover:bg-slate-800/50 transition-colors">
                <td className="px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center text-white text-sm font-bold shrink-0">{student.full_name[0].toUpperCase()}</div>
                    <span className="text-white text-sm font-medium">{student.full_name}</span>
                  </div>
                </td>
                <td className="px-5 py-4 hidden md:table-cell"><span className="text-slate-400 text-sm flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" />{student.email}</span></td>
                <td className="px-5 py-4 hidden lg:table-cell"><span className="text-slate-400 text-sm">{formatDate(student.created_at)}</span></td>
                <td className="px-5 py-4"><Badge variant={student.is_active ? 'green' : 'red'}>{student.is_active ? 'Active' : 'Disabled'}</Badge></td>
                <td className="px-5 py-4">
                  <div className="flex items-center gap-1 justify-end">
                    <Button variant="ghost" size="sm" onClick={() => toggleStatus(student)}><ToggleLeft className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => deleteStudent(student.id)} className="hover:text-red-400 hover:bg-red-500/10"><Trash2 className="w-4 h-4" /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add New Student">
        <form onSubmit={handleAdd} className="space-y-4">
          {error && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
          <Input label="Full Name" value={form.full_name} onChange={e => setForm(p => ({ ...p, full_name: e.target.value }))} required placeholder="Ali Mohammed" />
          <Input label="Email" type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} required placeholder="student@university.edu" />
          <Input label="Password" type="password" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} required />
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setShowAdd(false)} className="flex-1">Cancel</Button>
            <Button type="submit" loading={loading} className="flex-1">Add Student</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
