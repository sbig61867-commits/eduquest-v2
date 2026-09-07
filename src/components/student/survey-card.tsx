'use client'

import { useEffect, useState } from 'react'
import { Star, ClipboardList } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/components/ui/toast'

interface PendingSurvey { id: string; title: string; groupName: string }

// Self-contained island: fetches its own data, hides itself if there's
// nothing pending. Placed on the student dashboard so it's seen on login
// without adding a required step to any other flow.
export function SurveyCard() {
  const [survey, setSurvey] = useState<PendingSurvey | null | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)

  const [easeRating, setEaseRating] = useState(0)
  const [preferPlatform, setPreferPlatform] = useState<boolean | null>(null)
  const [recommend, setRecommend] = useState<boolean | null>(null)
  const [bestFeature, setBestFeature] = useState('')
  const [problemFaced, setProblemFaced] = useState('')
  const [comment, setComment] = useState('')

  useEffect(() => {
    fetch('/api/surveys/respond').then(r => r.json()).then(d => setSurvey(d.survey ?? null)).catch(() => setSurvey(null))
  }, [])

  async function submit() {
    if (!survey || easeRating === 0 || preferPlatform === null || recommend === null) {
      toast.error('يرجى الإجابة عن كل الأسئلة المطلوبة'); return
    }
    setLoading(true)
    const res = await fetch('/api/surveys/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        survey_id: survey.id, ease_rating: easeRating, prefer_platform: preferPlatform,
        recommend, best_feature: bestFeature, problem_faced: problemFaced, comment,
      }),
    })
    const data = await res.json()
    setLoading(false)
    if (!res.ok) { toast.error(data.error ?? 'فشل إرسال التقييم'); return }
    setSubmitted(true)
    setOpen(false)
  }

  if (!survey || submitted) return null

  return (
    <>
      <div className="bg-gradient-to-l from-blue-600/20 to-blue-600/5 border border-blue-500/30 rounded-lg p-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-accent-subtle flex items-center justify-center shrink-0">
            <ClipboardList className="w-5 h-5 text-accent" />
          </div>
          <div>
            <p className="text-fg font-semibold text-sm">قيّم تجربتك مع المنصة</p>
            <p className="text-fg-secondary text-xs mt-0.5">مجموعة {survey.groupName} — يستغرق أقل من دقيقة</p>
          </div>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>ابدأ التقييم</Button>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="تقييم تجربة المنصة">
        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-fg-secondary mb-2">ما مدى سهولة استخدام المنصة؟</label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} type="button" onClick={() => setEaseRating(n)} className="p-1">
                  <Star className={`w-7 h-7 ${n <= easeRating ? 'fill-amber-400 text-accent' : 'text-fg-muted'}`} />
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-fg-secondary mb-2">هل تفضل المنصة على الطريقة التقليدية؟</label>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant={preferPlatform === true ? 'primary' : 'secondary'} onClick={() => setPreferPlatform(true)}>نعم</Button>
              <Button type="button" size="sm" variant={preferPlatform === false ? 'primary' : 'secondary'} onClick={() => setPreferPlatform(false)}>لا</Button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-fg-secondary mb-2">هل تنصح زملاءك باستخدامها؟</label>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant={recommend === true ? 'primary' : 'secondary'} onClick={() => setRecommend(true)}>نعم</Button>
              <Button type="button" size="sm" variant={recommend === false ? 'primary' : 'secondary'} onClick={() => setRecommend(false)}>لا</Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-fg-secondary">ما أكثر ميزة أفادتك؟ (اختياري)</label>
            <input
              value={bestFeature} onChange={e => setBestFeature(e.target.value)} maxLength={500}
              className="w-full px-4 py-2.5 rounded-lg bg-surface border border-border-strong text-fg placeholder-fg-muted focus:outline-none focus:ring-2 focus:ring-accent text-sm"
              placeholder="مثال: التصحيح الفوري للواجبات"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-fg-secondary">هل واجهت مشكلة؟ (اختياري)</label>
            <input
              value={problemFaced} onChange={e => setProblemFaced(e.target.value)} maxLength={500}
              className="w-full px-4 py-2.5 rounded-lg bg-surface border border-border-strong text-fg placeholder-fg-muted focus:outline-none focus:ring-2 focus:ring-accent text-sm"
              placeholder="اختياري"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-fg-secondary">تعليق إضافي (اختياري)</label>
            <textarea
              value={comment} onChange={e => setComment(e.target.value)} rows={3} maxLength={1000}
              className="w-full px-4 py-2.5 rounded-lg bg-surface border border-border-strong text-fg placeholder-fg-muted focus:outline-none focus:ring-2 focus:ring-accent text-sm resize-none"
            />
          </div>

          <Button onClick={submit} loading={loading} className="w-full">إرسال التقييم</Button>
        </div>
      </Modal>
    </>
  )
}
