'use client'
import { confirmDialog } from '@/lib/confirm-dialog'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Input } from '@/components/ui/input'
import { Plus, Users, Pencil, Trash2, UserPlus, X, Search, Archive, ArchiveRestore, ClipboardList } from 'lucide-react'
import { toast } from '@/components/ui/toast'

interface Group {
  id: string
  name: string
  description: string | null
  created_at: string
  is_active: boolean
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
  teacherId: string
  tenantId: string
}

export function GroupsClient({ initialGroups, tenantStudents }: Props) {
  const router = useRouter()
  const [groups, setGroups] = useState(initialGroups)
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<Group | null>(null)
  const [form, setForm] = useState({ name: '', description: '' })
  const [formError, setFormError] = useState('')
  const [loading, setLoading] = useState(false)

  // Manage students modal
  const [managingGroup, setManagingGroup] = useState<Group | null>(null)
  const [groupStudents, setGroupStudents] = useState<Student[]>([])
  const [studentSearch, setStudentSearch] = useState('')
  const [loadingStudents, setLoadingStudents] = useState(false)

  // Survey modal
  const [surveyGroup, setSurveyGroup] = useState<Group | null>(null)
  const [surveyData, setSurveyData] = useState<{ id: string; title: string; is_open: boolean; created_at: string } | null>(null)
  const [surveyStats, setSurveyStats] = useState({ responseCount: 0, memberCount: 0 })
  const [surveyLoading, setSurveyLoading] = useState(false)

  async function openSurvey(group: Group) {
    setSurveyGroup(group)
    setSurveyLoading(true)
    const res = await fetch(`/api/surveys?group_id=${group.id}`)
    const json = await res.json()
    if (res.ok) {
      setSurveyData(json.survey)
      setSurveyStats({ responseCount: json.responseCount, memberCount: json.memberCount })
    }
    setSurveyLoading(false)
  }

  async function createSurvey() {
    if (!surveyGroup) return
    setSurveyLoading(true)
    const res = await fetch('/api/surveys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group_id: surveyGroup.id }),
    })
    const json = await res.json()
    if (!res.ok) { toast.error(json.error ?? 'فشل إنشاء الاستبيان'); setSurveyLoading(false); return }
    setSurveyData(json.survey)
    setSurveyLoading(false)
  }

  async function toggleSurveyOpen() {
    if (!surveyGroup || !surveyData) return
    const nextOpen = !surveyData.is_open
    const res = await fetch('/api/surveys', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group_id: surveyGroup.id, is_open: nextOpen }),
    })
    const json = await res.json()
    if (!res.ok) { toast.error(json.error ?? 'فشل تحديث الاستبيان'); return }
    setSurveyData(json.survey)
  }

  function openAdd() { setForm({ name: '', description: '' }); setEditing(null); setFormError(''); setShowAdd(true) }
  function openEdit(g: Group) { setForm({ name: g.name, description: g.description ?? '' }); setEditing(g); setFormError(''); setShowAdd(true) }

  async function openManage(group: Group) {
    setManagingGroup(group)
    setStudentSearch('')
    setLoadingStudents(true)
    const res = await fetch(`/api/group-students?group_id=${group.id}`)
    const json = await res.json()
    setGroupStudents(res.ok ? (json.students ?? []) : [])
    setLoadingStudents(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError('')
    setLoading(true)
    if (editing) {
      const res = await fetch('/api/groups', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editing.id, name: form.name, description: form.description }),
      })
      const json = await res.json()
      if (!res.ok) {
        setFormError(json.error ?? 'Failed to update group')
        setLoading(false)
        return
      }
      setGroups(prev => prev.map(g => g.id === editing.id ? { ...g, ...json } : g))
    } else {
      const res = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name, description: form.description }),
      })
      const json = await res.json()
      if (!res.ok) {
        setFormError(json.error ?? 'Failed to create group')
        setLoading(false)
        return
      }
      setGroups(prev => [json, ...prev])
    }
    setShowAdd(false)
    setLoading(false)
    router.refresh()
  }

  async function toggleArchive(group: Group) {
    const archiving = group.is_active
    if (archiving && !(await confirmDialog(`أرشفة مجموعة "${group.name}"؟ ستختفي دروسها وواجباتها واختباراتها عن الطلاب، وتبقى كل السجلات والعلامات محفوظة. يمكنك استرجاعها متى شئت.`))) return
    const res = await fetch('/api/groups', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: group.id, is_active: !group.is_active }),
    })
    const data = await res.json()
    if (!res.ok) { toast.error(data.error ?? 'فشل تغيير حالة المجموعة'); return }
    setGroups(prev => prev.map(g => g.id === group.id ? { ...g, is_active: data.is_active } : g))
    router.refresh()
  }

  async function deleteGroup(id: string) {
    if (!(await confirmDialog('حذف هذه المجموعة؟\n\nإن كان "الحذف النهائي" مفعّلاً من إعدادات المالك فستُمحى هي ودروسها واختباراتها وكل تسليمات وعلامات الطلاب نهائياً (لا رجعة). وإلا فستُنقل إلى الأرشيف مع حفظ كل السجلات.'))) return
    const res = await fetch('/api/groups', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (!res.ok) {
      toast.error((await res.json().catch(() => ({}))).error ?? 'فشل حذف المجموعة')
      return
    }
    setGroups(prev => prev.filter(g => g.id !== id))
    router.refresh()
  }

  async function addStudentToGroup(student: Student) {
    if (!managingGroup) return
    if (groupStudents.some(s => s.id === student.id)) return
    const res = await fetch('/api/group-students', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group_id: managingGroup.id, student_id: student.id }),
    })
    if (!res.ok) return
    setGroupStudents(prev => [...prev, student])
    setGroups(prev => prev.map(g =>
      g.id === managingGroup.id
        ? { ...g, group_students: [{ count: (g.group_students?.[0]?.count ?? 0) + 1 }] }
        : g
    ))
  }

  async function removeStudentFromGroup(studentId: string) {
    if (!managingGroup) return
    const res = await fetch('/api/group-students', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group_id: managingGroup.id, student_id: studentId }),
    })
    if (!res.ok) return
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
          <h2 className="text-xl font-semibold text-fg">My Groups</h2>
          <p className="text-fg-secondary mt-1">{groups.length} groups</p>
        </div>
        <Button onClick={openAdd}><Plus className="w-4 h-4" /> New Group</Button>
      </div>

      {groups.length === 0 ? (
        <div className="text-center py-20 bg-surface border border-border rounded-lg">
          <Users className="w-12 h-12 text-fg-muted mx-auto mb-3" />
          <p className="text-fg-secondary">No groups yet. Create your first group.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {groups.map(group => (
            <div key={group.id} className="bg-surface border border-border rounded-lg p-5 hover:border-border-strong transition-colors">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-lg bg-accent-subtle flex items-center justify-center">
                  <Users className="w-5 h-5 text-accent" />
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(group)}><Pencil className="w-3.5 h-3.5" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => toggleArchive(group)}
                    title={group.is_active ? 'أرشفة — إخفاء عن الطلاب مع حفظ السجلات' : 'استرجاع المجموعة'}
                    className={group.is_active ? 'hover:text-accent hover:bg-accent-subtle' : 'text-accent hover:text-accent hover:bg-accent-subtle'}>
                    {group.is_active ? <Archive className="w-3.5 h-3.5" /> : <ArchiveRestore className="w-3.5 h-3.5" />}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => deleteGroup(group.id)} className="hover:text-error hover:bg-error-subtle"><Trash2 className="w-3.5 h-3.5" /></Button>
                </div>
              </div>
              <h3 className="text-fg font-semibold mb-1">
                {group.name}
                {!group.is_active && <span className="ms-2 text-xs px-2 py-0.5 rounded bg-warning-subtle text-accent align-middle">مؤرشفة</span>}
              </h3>
              <p className="text-fg-secondary text-sm mb-4 line-clamp-2">{group.description || 'No description'}</p>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-fg-muted shrink-0">{group.group_students?.[0]?.count ?? 0} students</span>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => openSurvey(group)} title="استبيان تقييم التجربة">
                    <ClipboardList className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => openManage(group)}>
                    <UserPlus className="w-3.5 h-3.5" /> Manage Students
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit Group Modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title={editing ? 'Edit Group' : 'New Group'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && (
            <div className="p-3 rounded-lg bg-error-subtle border border-error/25 text-error text-sm">
              {formError}
            </div>
          )}
          <Input label="Group Name" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required placeholder="e.g. Computer Science - Batch 2024" />
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-fg-secondary">Description (optional)</label>
            <textarea
              value={form.description}
              onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
              rows={3}
              className="w-full px-4 py-2.5 rounded-lg bg-surface border border-border-strong text-fg placeholder-fg-muted focus:outline-none focus:ring-2 focus:ring-accent text-sm resize-none"
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
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-muted" />
            <input
              value={studentSearch}
              onChange={e => setStudentSearch(e.target.value)}
              placeholder="Search students..."
              className="w-full pl-10 pr-4 py-2 rounded-lg bg-surface border border-border-strong text-fg placeholder-fg-muted focus:outline-none focus:ring-2 focus:ring-accent text-sm"
            />
          </div>

          {/* Enrolled */}
          <div>
            <p className="text-xs font-semibold text-fg-secondary uppercase tracking-wider mb-2">
              Enrolled ({groupStudents.length})
            </p>
            {loadingStudents ? (
              <p className="text-fg-muted text-sm py-2">Loading...</p>
            ) : filteredEnrolled.length === 0 ? (
              <p className="text-fg-muted text-sm py-2">No enrolled students</p>
            ) : (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {filteredEnrolled.map(s => (
                  <div key={s.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-surface">
                    <div>
                      <p className="text-fg text-sm font-medium">{s.full_name}</p>
                      <p className="text-fg-secondary text-xs">{s.email}</p>
                    </div>
                    <button
                      onClick={() => removeStudentFromGroup(s.id)}
                      className="p-1 rounded text-fg-secondary hover:text-error hover:bg-error-subtle transition-colors"
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
            <p className="text-xs font-semibold text-fg-secondary uppercase tracking-wider mb-2">
              Add Students ({availableStudents.length} available)
            </p>
            {availableStudents.length === 0 ? (
              <p className="text-fg-muted text-sm py-2">All students are enrolled or none found</p>
            ) : (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {availableStudents.map(s => (
                  <div key={s.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-surface/50 hover:bg-surface transition-colors">
                    <div>
                      <p className="text-fg text-sm font-medium">{s.full_name}</p>
                      <p className="text-fg-secondary text-xs">{s.email}</p>
                    </div>
                    <button
                      onClick={() => addStudentToGroup(s)}
                      className="p-1 rounded text-fg-secondary hover:text-accent hover:bg-accent-subtle transition-colors"
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

      {/* Survey Modal */}
      <Modal open={!!surveyGroup} onClose={() => setSurveyGroup(null)} title={`استبيان التجربة — ${surveyGroup?.name ?? ''}`}>
        <div className="space-y-4">
          {surveyLoading ? (
            <p className="text-fg-secondary text-sm py-4 text-center">جارٍ التحميل...</p>
          ) : !surveyData ? (
            <div className="text-center py-4 space-y-3">
              <p className="text-fg-secondary text-sm">لا يوجد استبيان لهذه المجموعة بعد. أنشئه ليتمكن الطلاب من تقييم تجربتهم مع المنصة.</p>
              <Button onClick={createSurvey} loading={surveyLoading}>
                <ClipboardList className="w-4 h-4" /> إنشاء استبيان
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-lg bg-surface/50 border border-border-strong">
                <div>
                  <p className="text-fg font-medium">{surveyData.title}</p>
                  <p className="text-xs text-fg-secondary mt-1">
                    أجاب {surveyStats.responseCount} من {surveyStats.memberCount} طالب
                  </p>
                </div>
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${surveyData.is_open ? 'bg-success/15 text-accent' : 'bg-canvas text-fg-secondary'}`}>
                  {surveyData.is_open ? 'مفتوح' : 'مغلق'}
                </span>
              </div>
              <Button variant="secondary" onClick={toggleSurveyOpen} className="w-full">
                {surveyData.is_open ? 'إغلاق استقبال الإجابات' : 'إعادة فتح الاستبيان'}
              </Button>
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}
