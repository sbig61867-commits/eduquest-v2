'use client'
import { confirmDialog } from '@/lib/confirm-dialog'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Users, Archive, ArchiveRestore } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { formatDate } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { getTerms } from '@/lib/terminology'

// University-admin view over every group in the tenant: see the owning
// teacher and student count, archive/restore any group (records preserved).

interface GroupRow {
  id: string
  name: string
  description: string | null
  is_active: boolean
  created_at: string
  users: { full_name: string | null } | null
  group_students: { count: number }[]
}

interface AcademicData {
  units: { id: string; parent_id: string | null; level: number; name: string }[]
  terms: { id: string; name: string; is_current: boolean }[]
  links: Record<string, { academic_unit_id: string | null; term_id: string | null }>
}

export function AdminGroupsClient({ initialGroups, academic }: { initialGroups: GroupRow[]; academic?: AcademicData | null }) {
  const router = useRouter()
  const [groups, setGroups] = useState(initialGroups)
  const [busy, setBusy] = useState('')
  const [links, setLinks] = useState(academic?.links ?? {})
  const t = getTerms(useAuthStore(s => s.tenant?.institution_type))

  // Level-2 units listed under their parent, e.g. "Faculty › Department"
  const unitOptions = (academic?.units ?? []).flatMap(u => u.level !== 1 ? [] : [
    { id: u.id, label: u.name },
    ...(academic?.units ?? []).filter(c => c.parent_id === u.id).map(c => ({ id: c.id, label: `${u.name} › ${c.name}` })),
  ])

  async function classify(group: GroupRow, field: 'academic_unit_id' | 'term_id', value: string) {
    const previous = links[group.id]
    const next = { ...(previous ?? { academic_unit_id: null, term_id: null }), [field]: value || null }
    setLinks(prev => ({ ...prev, [group.id]: next }))
    const res = await fetch('/api/groups', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: group.id, [field]: value || null }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      toast.error(data.error ?? 'فشل الحفظ')
      setLinks(prev => ({ ...prev, [group.id]: previous }))
    }
  }

  async function toggleArchive(group: GroupRow) {
    const archiving = group.is_active
    if (archiving && !(await confirmDialog(`أرشفة مجموعة "${group.name}"؟ ستختفي عن الطلاب وتبقى كل السجلات والعلامات محفوظة.`))) return
    setBusy(group.id)
    const res = await fetch('/api/groups', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: group.id, is_active: !group.is_active }),
    })
    const data = await res.json()
    if (!res.ok) toast.error(data.error ?? 'فشل تغيير حالة المجموعة')
    else {
      setGroups(prev => prev.map(g => g.id === group.id ? { ...g, is_active: data.is_active } : g))
      router.refresh()
    }
    setBusy('')
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">{t.groupsAr}</h2>
        <p className="text-slate-400 mt-1">{groups.length} مجموعة · {groups.filter(g => !g.is_active).length} مؤرشفة</p>
      </div>

      {groups.length === 0 ? (
        <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl">
          <Users className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">لا توجد مجموعات بعد — ينشئها المعلمون من لوحاتهم.</p>
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800 text-start">
                <th className="text-start text-xs font-medium text-slate-400 uppercase px-5 py-3">المجموعة</th>
                <th className="text-start text-xs font-medium text-slate-400 uppercase px-5 py-3 hidden md:table-cell">المعلم</th>
                {academic && <th className="text-start text-xs font-medium text-slate-400 uppercase px-5 py-3 hidden lg:table-cell">{t.unitL1} / {t.term}</th>}
                <th className="text-start text-xs font-medium text-slate-400 uppercase px-5 py-3">الطلاب</th>
                <th className="text-start text-xs font-medium text-slate-400 uppercase px-5 py-3 hidden md:table-cell">أنشئت</th>
                <th className="text-start text-xs font-medium text-slate-400 uppercase px-5 py-3">الحالة</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {groups.map(group => (
                <tr key={group.id} className={`hover:bg-slate-800/50 transition-colors ${!group.is_active ? 'opacity-60' : ''}`}>
                  <td className="px-5 py-4">
                    <p className="text-white text-sm font-medium">{group.name}</p>
                    {group.description && <p className="text-slate-500 text-xs truncate max-w-[200px]">{group.description}</p>}
                  </td>
                  <td className="px-5 py-4 hidden md:table-cell text-slate-300 text-sm">{group.users?.full_name ?? '—'}</td>
                  {academic && (
                    <td className="px-5 py-4 hidden lg:table-cell">
                      <div className="flex flex-col gap-1.5 min-w-[180px]">
                        <select
                          aria-label={t.unitL1}
                          value={links[group.id]?.academic_unit_id ?? ''}
                          onChange={e => classify(group, 'academic_unit_id', e.target.value)}
                          className="rounded-md bg-slate-800 border border-slate-700 text-slate-200 text-xs px-2 py-1"
                        >
                          <option value="">— {t.unitL1} —</option>
                          {unitOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                        </select>
                        <select
                          aria-label={t.term}
                          value={links[group.id]?.term_id ?? ''}
                          onChange={e => classify(group, 'term_id', e.target.value)}
                          className="rounded-md bg-slate-800 border border-slate-700 text-slate-200 text-xs px-2 py-1"
                        >
                          <option value="">— {t.term} —</option>
                          {academic.terms.map(o => <option key={o.id} value={o.id}>{o.name}{o.is_current ? ' ★' : ''}</option>)}
                        </select>
                      </div>
                    </td>
                  )}
                  <td className="px-5 py-4 text-slate-300 text-sm">{group.group_students?.[0]?.count ?? 0}</td>
                  <td className="px-5 py-4 hidden md:table-cell text-slate-400 text-sm">{formatDate(group.created_at)}</td>
                  <td className="px-5 py-4">
                    <Badge variant={group.is_active ? 'green' : 'yellow'}>{group.is_active ? 'نشطة' : 'مؤرشفة'}</Badge>
                  </td>
                  <td className="px-5 py-4 text-end">
                    <Button variant="ghost" size="sm" loading={busy === group.id} onClick={() => toggleArchive(group)}
                      title={group.is_active ? 'أرشفة' : 'استرجاع'}>
                      {group.is_active
                        ? <><Archive className="w-3.5 h-3.5" /> أرشفة</>
                        : <><ArchiveRestore className="w-3.5 h-3.5" /> استرجاع</>}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
