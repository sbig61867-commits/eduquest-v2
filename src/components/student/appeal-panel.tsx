'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { FileWarning, Clock, CheckCircle2, XCircle } from 'lucide-react'

// A student's channel to dispute a proctoring flag on one of their
// submissions, directed to the exam's teacher. Deliberately a GENERAL appeal
// (no violation_type/violation_at) — students currently have no view of
// their own individual recorded events (proctoring_events is teacher-only),
// so this disputes "this exam was flagged" as a whole, not one specific
// detection. See src/app/api/appeals/route.ts.

export interface AppealSummary {
  id: string
  status: 'pending' | 'upheld' | 'rejected'
  student_message: string
  teacher_response: string | null
  created_at: string
  resolved_at: string | null
}

const STATUS: Record<AppealSummary['status'], { label: string; icon: typeof Clock; className: string }> = {
  pending:  { label: 'قيد المراجعة', icon: Clock,        className: 'text-amber-400' },
  upheld:   { label: 'تم قبول الطعن', icon: CheckCircle2, className: 'text-emerald-400' },
  rejected: { label: 'تم رفض الطعن',  icon: XCircle,      className: 'text-red-400' },
}

export function AppealButton({ submissionId, existing }: { submissionId: string; existing?: AppealSummary | null }) {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [appeal, setAppeal] = useState<AppealSummary | null | undefined>(existing)

  async function submit() {
    if (message.trim().length < 5) {
      toast.error('يرجى كتابة تفاصيل الطعن (5 أحرف على الأقل)')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/appeals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionId, message: message.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'تعذّر إرسال الطعن')
        return
      }
      toast.success('تم إرسال طعنك — سيراجعه معلم المادة')
      setAppeal({ id: data.id, status: 'pending', student_message: message.trim(), teacher_response: null, created_at: new Date().toISOString(), resolved_at: null })
      setOpen(false)
      setMessage('')
    } catch {
      toast.error('خطأ في الشبكة، حاول مرة أخرى')
    } finally {
      setSubmitting(false)
    }
  }

  if (appeal) {
    const s = STATUS[appeal.status]
    const Icon = s.icon
    return (
      <span className={`flex items-center gap-1.5 text-xs font-medium ${s.className}`} title={appeal.teacher_response ?? undefined}>
        <Icon className="w-3.5 h-3.5" /> {s.label}
      </span>
    )
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-amber-400 transition-colors"
      >
        <FileWarning className="w-3.5 h-3.5" /> تقديم طعن
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="تقديم طعن على مخالفة مراقبة" size="md">
        <div className="p-5 space-y-4">
          <p className="text-slate-400 text-sm leading-relaxed">
            إن كنتَ تعتقد أن اختبارك سُجِّلت عليه مخالفة مراقبة خطأً، اشرح ما حدث بالتفصيل. سيصل طعنك لمعلم المادة
            للمراجعة، ويمكن للإدارة الاطلاع عليه ضمن تقرير الطعونات الكامل.
          </p>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            rows={5}
            maxLength={2000}
            placeholder="مثال: انقطع اتصالي بالإنترنت لحظياً، أو غادرت الكاميرا مجال الرؤية بسبب ظرف طارئ..."
            className="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button variant="primary" onClick={submit} loading={submitting}>إرسال الطعن</Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
