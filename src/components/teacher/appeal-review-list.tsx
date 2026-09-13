'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { formatDateTime } from '@/lib/utils'
import { Gavel, CheckCircle2, XCircle } from 'lucide-react'

export interface AppealRow {
  id: string
  student_name: string
  exam_title: string
  group_name: string
  violation_type: string | null
  student_message: string
  created_at: string
}

export function AppealReviewList({ appeals }: { appeals: AppealRow[] }) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [responses, setResponses] = useState<Record<string, string>>({})

  async function resolve(id: string, status: 'upheld' | 'rejected') {
    const response = (responses[id] ?? '').trim()
    if (response.length < 3) {
      toast.error('يرجى كتابة رد على الطالب قبل البت في الطعن')
      return
    }
    setBusyId(id)
    try {
      const res = await fetch(`/api/appeals/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, response }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'تعذّر حفظ القرار'); return }
      toast.success(status === 'upheld' ? 'تم قبول الطعن' : 'تم رفض الطعن')
      router.refresh()
    } catch {
      toast.error('خطأ في الشبكة')
    } finally {
      setBusyId(null)
    }
  }

  if (!appeals.length) return null

  return (
    <div className="bg-slate-900 border border-amber-900/40 rounded-xl p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Gavel className="w-4 h-4 text-amber-400" />
        <p className="text-white font-semibold">طعونات بانتظار المراجعة</p>
        <span className="text-slate-500 text-xs">({appeals.length})</span>
      </div>
      <div className="space-y-3">
        {appeals.map(a => (
          <div key={a.id} className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 space-y-3">
            <div>
              <p className="text-white text-sm font-medium">{a.student_name} · {a.exam_title}</p>
              <p className="text-slate-500 text-xs">{a.group_name} · {a.violation_type ?? 'طعن عام'} · {formatDateTime(a.created_at)}</p>
            </div>
            <p className="text-slate-300 text-sm bg-slate-900/60 rounded-lg p-3">{a.student_message}</p>
            <textarea
              value={responses[a.id] ?? ''}
              onChange={e => setResponses(p => ({ ...p, [a.id]: e.target.value }))}
              rows={2}
              placeholder="ردّك على الطالب (يظهر له مع القرار)..."
              className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => resolve(a.id, 'rejected')} loading={busyId === a.id}>
                <XCircle className="w-4 h-4" /> رفض الطعن
              </Button>
              <Button variant="primary" onClick={() => resolve(a.id, 'upheld')} loading={busyId === a.id} className="bg-emerald-600 hover:bg-emerald-500">
                <CheckCircle2 className="w-4 h-4" /> قبول الطعن
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
