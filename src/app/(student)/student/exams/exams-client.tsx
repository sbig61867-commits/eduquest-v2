'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ClipboardList, ShieldCheck, Clock, Play } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { ExamTaker } from './exam-taker'
import type { Exam } from '@/types'

interface Props {
  exams: (Exam & { groups: { name: string } | null })[]
  submittedIds: Set<string>
  userId: string
  tenantId: string
}

export function StudentExamsClient({ exams, submittedIds, userId, tenantId }: Props) {
  const [activeExam, setActiveExam] = useState<Exam | null>(null)

  if (activeExam) return <ExamTaker exam={activeExam} userId={userId} tenantId={tenantId} onFinish={() => setActiveExam(null)} />

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">My Exams</h2>
        <p className="text-slate-400 mt-1">{exams.length} available exams</p>
      </div>

      {exams.length === 0 ? (
        <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl">
          <ClipboardList className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">No exams available yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {exams.map(exam => {
            const done = submittedIds.has(exam.id)
            return (
              <div key={exam.id} className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-white font-semibold mb-1">{exam.title}</h3>
                    <p className="text-slate-400 text-sm">{(exam as any).groups?.name ?? '—'}</p>
                  </div>
                  {done && <Badge variant="green">Submitted</Badge>}
                </div>
                <div className="flex items-center gap-4 mb-4 text-sm text-slate-500">
                  <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{exam.duration_minutes} min</span>
                  <span className="flex items-center gap-1"><ClipboardList className="w-3.5 h-3.5" />{exam.questions.length} questions</span>
                  {exam.proctoring_enabled && <span className="flex items-center gap-1 text-blue-400"><ShieldCheck className="w-3.5 h-3.5" />Proctored</span>}
                </div>
                <Button
                  className="w-full"
                  variant={done ? 'secondary' : 'primary'}
                  disabled={done}
                  onClick={() => setActiveExam(exam)}
                >
                  <Play className="w-4 h-4" />
                  {done ? 'Already Submitted' : 'Start Exam'}
                </Button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
