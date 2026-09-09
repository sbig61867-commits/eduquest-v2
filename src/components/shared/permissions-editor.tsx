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
      <div className="text-center py-16 bg-surface border border-border rounded-lg" dir="rtl">
        <UserCog className="w-12 h-12 text-fg-muted mx-auto mb-3" />
        <p className="text-fg-secondary">{emptyHint}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4" dir="rtl">
      {staff.map(member => {
        const current = draft[member.id] ?? member.effective
        const dirty = CAPABILITIES.some(c => current[c] !== member.effective[c])
        return (
          <div key={member.id} className="bg-surface border border-border rounded-lg p-5">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="min-w-0">
                <p className="text-fg font-semibold truncate">{member.full_name ?? '—'}</p>
                <p className="text-fg-muted text-xs truncate">{member.email}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {!member.is_active && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-error-subtle text-error">معطّل</span>
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
                      allowed ? 'border-border hover:bg-surface/40 cursor-pointer' : 'border-border/50 opacity-45'
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
                      <span className="block text-sm text-fg">{CAPABILITY_LABELS[cap]}</span>
                      <span className="block text-xs text-fg-muted">{CAPABILITY_HINTS[cap]}</span>
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
