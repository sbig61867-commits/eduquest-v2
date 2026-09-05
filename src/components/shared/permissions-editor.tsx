'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { CAPABILITIES, CAPABILITY_LABELS, CAPABILITY_HINTS, type Capability } from '@/lib/permissions'
import { ShieldCheck, UserCog } from 'lucide-react'

export interface StaffMember {
  id: string
  full_name: string | null
  email: string
  role: string
  is_active: boolean
  /** Effective (defaults already resolved) capability map. */
  effective: Record<Capability, boolean>
}

/**
 * Capability toggles for staff the current user may configure.
 * `grantable` is the editor's OWN effective map — a capability the editor
 * doesn't hold is shown disabled, mirroring the server-side escalation guard.
 */
export function PermissionsEditor({ staff, grantable, emptyHint }: {
  staff: StaffMember[]
  grantable: Record<Capability, boolean>
  emptyHint: string
}) {
  const router = useRouter()
  const [draft, setDraft] = useState<Record<string, Record<Capability, boolean>>>(
    () => Object.fromEntries(staff.map(s => [s.id, { ...s.effective }])),
  )
  const [savingId, setSavingId] = useState('')

  async function save(member: StaffMember) {
    setSavingId(member.id)
    const res = await fetch('/api/admin/permissions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: member.id, permissions: draft[member.id] }),
    })
    const data = await res.json()
    setSavingId('')
    if (!res.ok) return toast.error(data.error ?? 'تعذّر حفظ الصلاحيات')
    toast.success('تم حفظ الصلاحيات')
    router.refresh()
  }

  if (staff.length === 0) {
    return (
      <div className="text-center py-16 bg-slate-900 border border-slate-800 rounded-xl" dir="rtl">
        <UserCog className="w-12 h-12 text-slate-600 mx-auto mb-3" />
        <p className="text-slate-400">{emptyHint}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4" dir="rtl">
      {staff.map(member => {
        const current = draft[member.id] ?? member.effective
        const dirty = CAPABILITIES.some(c => current[c] !== member.effective[c])
        return (
          <div key={member.id} className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="min-w-0">
                <p className="text-white font-semibold truncate">{member.full_name ?? '—'}</p>
                <p className="text-slate-500 text-xs truncate">{member.email}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {!member.is_active && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-400">معطّل</span>
                )}
                <Button size="sm" loading={savingId === member.id} disabled={!dirty} onClick={() => save(member)}>
                  <ShieldCheck className="w-3.5 h-3.5" /> حفظ
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {CAPABILITIES.map(cap => {
                const allowed = grantable[cap]
                const on = current[cap]
                return (
                  <label
                    key={cap}
                    className={`flex items-start gap-2.5 p-2.5 rounded-lg border transition-colors ${
                      allowed ? 'border-slate-800 hover:bg-slate-800/40 cursor-pointer' : 'border-slate-800/50 opacity-45'
                    }`}
                    title={allowed ? CAPABILITY_HINTS[cap] : 'لا تملك هذه الصلاحية فلا يمكنك منحها'}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={on}
                      disabled={!allowed}
                      onChange={e => setDraft(d => ({
                        ...d,
                        [member.id]: { ...current, [cap]: e.target.checked },
                      }))}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm text-slate-200">{CAPABILITY_LABELS[cap]}</span>
                      <span className="block text-xs text-slate-500">{CAPABILITY_HINTS[cap]}</span>
                    </span>
                  </label>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
