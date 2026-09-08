'use client'
import { confirmDialog } from '@/lib/confirm-dialog'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Users, Archive, ArchiveRestore } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { formatDate } from '@/lib/utils'

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

export function AdminGroupsClient({ initialGroups }: { initialGroups: GroupRow[] }) {
  const router = useRouter()
  const [groups, setGroups] = useState(initialGroups)
  const [busy, setBusy] = useState('')

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
        <h2 className="text-xl font-semibold text-fg">المجموعات (الفصول)</h2>
        <p className="text-fg-secondary mt-1">{groups.length} مجموعة · {groups.filter(g => !g.is_active).length} مؤرشفة</p>
      </div>

      {groups.length === 0 ? (
        <div className="text-center py-20 bg-surface border border-border rounded-lg">
          <Users className="w-12 h-12 text-fg-muted mx-auto mb-3" />
          <p className="text-fg-secondary">لا توجد مجموعات بعد — ينشئها المعلمون من لوحاتهم.</p>
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-start">
                <th className="text-start text-xs font-medium text-fg-secondary uppercase px-5 py-3">المجموعة</th>
                <th className="text-start text-xs font-medium text-fg-secondary uppercase px-5 py-3 hidden md:table-cell">المعلم</th>
                <th className="text-start text-xs font-medium text-fg-secondary uppercase px-5 py-3">الطلاب</th>
                <th className="text-start text-xs font-medium text-fg-secondary uppercase px-5 py-3 hidden md:table-cell">أنشئت</th>
                <th className="text-start text-xs font-medium text-fg-secondary uppercase px-5 py-3">الحالة</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {groups.map(group => (
                <tr key={group.id} className={`hover:bg-surface/50 transition-colors ${!group.is_active ? 'opacity-60' : ''}`}>
                  <td className="px-5 py-4">
                    <p className="text-fg text-sm font-medium">{group.name}</p>
                    {group.description && <p className="text-fg-muted text-xs truncate max-w-[200px]">{group.description}</p>}
                  </td>
                  <td className="px-5 py-4 hidden md:table-cell text-fg-secondary text-sm">{group.users?.full_name ?? '—'}</td>
                  <td className="px-5 py-4 text-fg-secondary text-sm">{group.group_students?.[0]?.count ?? 0}</td>
                  <td className="px-5 py-4 hidden md:table-cell text-fg-secondary text-sm">{formatDate(group.created_at)}</td>
                  <td className="px-5 py-4">
                    <Badge variant={group.is_active ? 'success' : 'warning'}>{group.is_active ? 'نشطة' : 'مؤرشفة'}</Badge>
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
