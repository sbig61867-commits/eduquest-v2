'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { GitCompareArrows, ChevronDown, ChevronUp } from 'lucide-react'
import type { SimilarPair } from '@/lib/answer-similarity'

// Collusion hints for one exam (src/lib/answer-similarity.ts): pairs of
// students who share rare identical wrong answers or nearly identical written
// answers. Collapsed by default and worded as a hint, never an accusation.
export function SimilarityPanel({ pairs }: { pairs: SimilarPair[] }) {
  const t = useTranslations('teacher.exams.results.similarity')
  const [open, setOpen] = useState(false)
  if (pairs.length === 0) return null

  return (
    <div className="border border-amber-500/30 bg-amber-500/5 rounded-xl">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 px-4 py-3 text-start">
        <GitCompareArrows className="w-4 h-4 text-amber-400 shrink-0" />
        <span className="flex-1 text-amber-300 text-sm font-medium">{t('title', { count: pairs.length })}</span>
        {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3">
          <p className="text-slate-400 text-xs leading-relaxed">{t('note')}</p>
          <ul className="space-y-2">
            {pairs.map(p => (
              <li key={`${p.a.studentId}-${p.b.studentId}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-2 text-sm">
                <span className="text-white font-medium">{p.a.name}</span>
                <span className="text-slate-500">↔</span>
                <span className="text-white font-medium">{p.b.name}</span>
                <span className="text-slate-400 text-xs ms-auto">
                  {p.sameWrong > 0 && t('sameWrong', { same: p.sameWrong, wrong: p.bothWrong })}
                  {p.sameWrong > 0 && p.sameText > 0 && ' · '}
                  {p.sameText > 0 && t('sameText', { count: p.sameText })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
