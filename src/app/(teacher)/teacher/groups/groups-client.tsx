'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Input } from '@/components/ui/input'
import { Plus, Users, Pencil, Trash2, UserPlus, X, Search } from 'lucide-react'
import { formatDate } from '@/lib/utils'

interface Group {
  id: string
  name: string
  description: string | null
  created_at: string
  group_students: { count: number }[]
}

interface Student {
  id: string
  full_name: string
  email: string
}

interface Props {
  initialGroups: Group[]
  tenantStudents: Student[]
}

export function GroupsClient({ initialGroups, tenantStudents }: Props) {
  const [groups, setGroups] = useState(initialGroups)
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<Group | null>(null)
  const [form, setForm] = useState({ name: '', description: '' })
  const [loading, setLoading] = useState(false)

  // Manage students modal
  const [managingGroup, setManagingGroup] = useState<Group | null>(null)
  const [groupStudents, setGroupStudents] = useState<Student[]>([])
  const [studentSearch, setStudentSearch] = useState('')
  const [loadingStudents, setLoadingStudents] = useState(false)

  const supabase = createClient()

  function openAdd() { setForm({ name: '', description: '' }); setEditing(null); setShowAdd(true) }
  function openEdit(g: Group) { setForm({ name: g.name, description: g.description ?? '' }); setEditing(g); setShowAdd(true) }

  async function openManage(group: Group) {
    setManagingGroup(group)
    setStudentSearch('')
    setLoadingStudents(true)
    const { data } = await supabase
      .from('group_students')
      .select('student_id, users!group_students_student_id_fkey(id, full_name, email)')
      .eq('group_id', group.id)
    const students = (data ?? []).map((r: any) => r.users).filter(Boolean)
    setGroupStudents(students)
    setLoadingStudents(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    if (editing) {
      const { data } = await supabase
        .from('groups')
        .update({ name: form.name, description: form.description })
        .eq('id', editing.id)
        .select()
        .single()
      if (data) setGroups(prev => prev.map(g => g.id === editing.id ? { ...g, ...data } : g))
    } else {
      const { data } = await supabase
        .from('groups')
        .insert({ name: form.name, description: form.description })
        .select('*, group_students(count)')
        .single()
      if (data) setGroups(prev => [data, ...prev])
    }
    setShowAdd(false)
    setLoading(false)
  }

  async function deleteGroup(id: string) {
    if (!confirm('Delete this group? All related lessons and exams will be removed.')) return
    await supabase.from('groups').delete().eq('id', id)
    setGroups(prev => prev.filter(g => g.id !== id))
  }

  async function addStudentToGroup(student: Student) {
    if (!managingGroup) return
    const alreadyIn = groupStudents.some(s => s.id === student.id)
    if (alreadyIn) return
    await supabase.from('group_students').insert({ group_id: managingGroup.id, student_id: student.id })
    setGroupStudents(prev => [...prev, student])
    setGroups(prev => prev.map(g =>
      g.id === managingGroup.id
        ? { ...g, group_students: [{ count: (g.group_students?.[0]?.count ?? 0) + 1 }] }
        : g
    ))
  }

  async function removeStudentFromGroup(studentId: string) {
    if (!managingGroup) return
    await supabase.from('group_students')
      .delete()
      .eq('group_id', managingGroup.id)
      .eq('student_id', studentId)
    setGroupStudents(prev => prev.filter(s => s.id !== studentId))
    setGroups(prev => prev.map(g =>
      g.id === managingGroup.id
        ? { ...g, group_students: [{ count: Math.max((g.group_students?.[0]?.count ?? 1) - 1, 0) }] }
        : g
    ))
  }

  const enrolledIds = new Set(groupStudents.map(s => s.id))
  const availableStudents = tenantStudents.filter(s =>
    !enrolledIds.has(s.id) &&
    (s.full_name.toLowerCase().includes(studentSearch.toLowerCase()) ||
     s.email.toLowerCase().includes(studentSearch.toLowerCase()))
  )
  const filteredEnrolled = groupStudents.filter(s =>
    s.full_name.toLowerCase().includes(studentSearch.toLowerCase()) ||
    s.email.toLowerCase().includes(studentSearch.toLowerCase())
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">My Groups</h2>
          <p className="text-slate-400 mt-1">{groups.length} groups</p>
        </div>
        <Button onClick={openAdd}><Plus className="w-4 h-4" /> New Group</Button>
      </div>

      {groups.length === 0 ? (
        <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl">
          <Users className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">No groups yet. Create your first group.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {groups.map(group => (
            <div key={group.id} className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition-colors">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-lg bg-blue-600/20 flex items-center justify-center">
                  <Users className="w-5 h-5 text-blue-400" />
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(group)}><Pencil className="w-3.5 h-3.5" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => deleteGroup(group.id)} className="hover:text-red-400 hover:bg-red-500/10"><Trash2 className="w-3.5 h-3.5" /></Button>
                </div>
              </div>
              <h3 className="text-white font-semibold mb-1">{group.name}</h3>
              <p className="text-slate-400 text-sm mb-4 line-clamp-2">{group.description || 'No description'}</p>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">{group.group_students?.[0]?.count ?? 0} students</span>
                <Button variant="secondary" size="sm" onClick={() => openManage(group)}>
                  <UserPlus className="w-3.5 h-3.5" /> Manage Students
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit Group Modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title={editing ? 'Edit Group' : 'New Group'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input label="Group Name" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required placeholder="e.g. Computer Science - Batch 2024" />
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-300">Description (optional)</label>
            <textarea
              value={form.description}
              onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
              rows={3}
              className="w-full px-4 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-none"
              placeholder="Brief description..."
            />
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setShowAdd(false)} className="flex-1">Cancel</Button>
            <Button type="submit" loading={loading} className="flex-1">{editing ? 'Save Changes' : 'Create Group'}</Button>
          </div>
        </form>
      </Modal>

      {/* Manage Students Modal */}
      <Modal open={!!managingGroup} onClose={() => setManagingGroup(null)} title={`Manage Students — ${managingGroup?.name ?? ''}`}>
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              value={studentSearch}
              onChange={e => setStudentSearch(e.target.value)}
              placeholder="Search students..."
              className="w-full pl-10 pr-4 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
          </div>

          {/* Enrolled */}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Enrolled ({groupStudents.length})
            </p>
            {loadingStudents ? (
              <p className="text-slate-500 text-sm py-2">Loading...</p>
            ) : filteredEnrolled.length === 0 ? (
              <p className="text-slate-500 text-sm py-2">No enrolled students</p>
            ) : (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {filteredEnrolled.map(s => (
                  <div key={s.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-800">
                    <div>
                      <p className="text-white text-sm font-medium">{s.full_name}</p>
                      <p className="text-slate-400 text-xs">{s.email}</p>
                    </div>
                    <button
                      onClick={() => removeStudentFromGroup(s.id)}
                      className="p-1 rounded text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Available to add */}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Add Students ({availableStudents.length} available)
            </p>
            {availableStudents.length === 0 ? (
              <p className="text-slate-500 text-sm py-2">All students are enrolled or none found</p>
            ) : (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {availableStudents.map(s => (
                  <div key={s.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-800/50 hover:bg-slate-800 transition-colors">
                    <div>
                      <p className="text-white text-sm font-medium">{s.full_name}</p>
                      <p className="text-slate-400 text-xs">{s.email}</p>
                    </div>
                    <button
                      onClick={() => addStudentToGroup(s)}
                      className="p-1 rounded text-slate-400 hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Button variant="secondary" onClick={() => setManagingGroup(null)} className="w-full">Done</Button>
        </div>
      </Modal>
    </div>
  )
}
