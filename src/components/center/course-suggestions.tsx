'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { Sparkles, RefreshCw } from 'lucide-react'

// On-demand only. The page already shows the free rule-based reading; the
// model is called when — and only when — the manager presses this button,
// and the route is rate-limited to 10 requests per hour per user.
export function CourseSuggestions({ courseId, days }: { courseId: string; days: number }) {
  const t = useTranslations('staff.suggestions')
  const [items, setItems] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(false)

  async function ask() {
    setLoading(true)
    const res = await fetch('/api/ai/course-suggestions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ course_id: courseId, days }),
    })
    const data = await res.json().catch(() => ({}))
    setLoading(false)
    if (!res.ok) return toast.error(data.error ?? t('fetchFailed'))
    setItems(data.suggestions as string[])
  }

  return (
    <div className="space-y-2">
      <Button variant="ghost" onClick={ask} loading={loading} className="text-xs">
        {items ? <RefreshCw className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
        {items ? t('again') : t('ask')}
      </Button>

      {items && (
        <ul className="space-y-1.5 bg-slate-950/60 border border-slate-800 rounded-lg p-3">
          {items.map((s, i) => (
            <li key={i} className="text-slate-300 text-xs leading-relaxed">• {s}</li>
          ))}
          <li className="text-slate-600 text-[11px] pt-1">
            {t('disclaimer')}
          </li>
        </ul>
      )}
    </div>
  )
}
