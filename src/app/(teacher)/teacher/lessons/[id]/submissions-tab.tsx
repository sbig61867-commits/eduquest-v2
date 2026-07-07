'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ChevronDown, ChevronUp, CheckCircle2, XCircle, Send, Save, EyeOff } from 'lucide-react'

// Teacher grading view for a lesson's homework: who submitted, their
// answers, manual points for essay questions, and publishing results.

interface Question {
  id: string; text: string; type: 'mcq' | 'true_false' | 'short_answer' | 'essay'
  options?: string[]; correct_answer: string; points: number
}
interface Submission {
  id: string; student_name: string; student_email: string
  answers: Record<string, string>; score: number | null; max_score: number | null
  grading_status: 'pending' | 'reviewing' | 'published'; submitted_at: string
}
interface HomeworkRow { id: string; title: string; questions: Question[]; submissions: Submission[] }

const isAuto = (q: Question) => q.type === 'mcq' || q.type === 'true_false'
const isAutoCorrect = (q: Question, ans?: string) =>
  (ans ?? '').trim().toLowerCase() === (q.correct_answer ?? '').trim().toLowerCase()

function autoScore(questions: Question[], answers: Record<string, string>): number {
  return questions.reduce((s, q) => s + (isAuto(q) && isAutoCorrect(q, answers[q.id]) ? q.points : 0), 0)
}

export function SubmissionsTab({ lessonId }: { lessonId: string }) {
  const [homework, setHomework] = useState<HomeworkRow[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  // per-submission essay points: { [subId]: { [questionId]: points } }
  const [essayPoints, setEssayPoints] = useState<Record<string, Record<string, number>>>({})
  const [busy, setBusy] = useState<string>('')

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/homework/submissions?lesson_id=${lessonId}`)
    const data = await res.json()
    if (res.ok) setHomework(data.homework ?? [])
    setLoading(false)
  }, [lessonId])

  useEffect(() => { load() }, [load])

  async function patchSub(subId: string, patch: { score?: number; grading_status?: string }) {
    setBusy(subId)
    const res = await fetch('/api/homework/submissions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: subId, ...patch }),
    })
    if (!res.ok) alert((await res.json()).error ?? 'فشل الحفظ')
    else await load()
    setBusy('')
  }

  function totalFor(hw: HomeworkRow, sub: Submission): number {
    const essays = essayPoints[sub.id] ?? {}
    const essaySum = hw.questions.filter(q => !isAuto(q)).reduce((s, q) => s + (essays[q.id] ?? 0), 0)
    return autoScore(hw.questions, sub.answers) + essaySum
  }

  const STATUS: Record<Submission['grading_status'], { label: string; variant: 'yellow' | 'blue' | 'green' }> = {
    pending: { label: 'بانتظار التصحيح', variant: 'yellow' },
    reviewing: { label: 'مُصحَّح — غير منشور', variant: 'blue' },
    published: { label: 'منشور للطالب', variant: 'green' },
  }

  if (loading) return <p className="text-slate-500 text-sm py-8 text-center">جاري تحميل التسليمات...</p>
  if (homework.length === 0) return <p className="text-slate-500 text-sm py-8 text-center">لا توجد واجبات لهذا الدرس بعد.</p>

  return (
    <div className="space-y-6">
      {homework.map(hw => {
        const hasEssay = hw.questions.some(q => !isAuto(q))
        const unpublished = hw.submissions.filter(s => s.grading_status !== 'published')
        return (
          <div key={hw.id} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800">
              <div>
                <p className="text-white font-semibold">{hw.title}</p>
                <p className="text-slate-500 text-xs mt-0.5">{hw.submissions.length} تسليم · {hw.questions.length} سؤال{hasEssay ? ' · يتضمن أسئلة مقالية' : ''}</p>
              </div>
              {unpublished.length > 0 && (
                <Button size="sm" variant="secondary"
                  onClick={async () => { for (const s of unpublished) await patchSub(s.id, { grading_status: 'published' }) }}>
                  <Send className="w-3.5 h-3.5" /> نشر الكل ({unpublished.length})
                </Button>
              )}
            </div>

            {hw.submissions.length === 0 ? (
              <p className="text-slate-500 text-sm px-5 py-6 text-center">لم يسلّم أي طالب هذا الواجب بعد.</p>
            ) : hw.submissions.map(sub => {
              const open = expanded === sub.id
              const st = STATUS[sub.grading_status]
              return (
                <div key={sub.id} className="border-b border-slate-800/60 last:border-b-0">
                  <button
                    onClick={() => setExpanded(open ? null : sub.id)}
                    className="w-full flex items-center gap-3 px-5 py-3 hover:bg-slate-800/40 transition-colors text-start"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium truncate">{sub.student_name}</p>
                      <p className="text-slate-500 text-xs truncate">{sub.student_email} · {new Date(sub.submitted_at).toLocaleString('ar')}</p>
                    </div>
                    <span className="text-slate-300 text-sm font-mono shrink-0">{sub.score ?? '—'} / {sub.max_score ?? '—'}</span>
                    <Badge variant={st.variant}>{st.label}</Badge>
                    {open ? <ChevronUp className="w-4 h-4 text-slate-500 shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />}
                  </button>

                  {open && (
                    <div className="px-5 pb-4 space-y-3 bg-slate-950/40">
                      {hw.questions.map((q, qi) => {
                        const ans = sub.answers?.[q.id] ?? ''
                        const auto = isAuto(q)
                        const correct = auto && isAutoCorrect(q, ans)
                        return (
                          <div key={q.id} className="rounded-lg border border-slate-800 p-3 space-y-2">
                            <div className="flex items-start gap-2">
                              <span className="text-slate-500 text-xs font-mono mt-0.5">{qi + 1}.</span>
                              <p className="flex-1 text-slate-200 text-sm">{q.text}</p>
                              {auto && (correct
                                ? <span className="flex items-center gap-1 text-emerald-400 text-xs shrink-0"><CheckCircle2 className="w-3.5 h-3.5" />{q.points} د</span>
                                : <span className="flex items-center gap-1 text-red-400 text-xs shrink-0"><XCircle className="w-3.5 h-3.5" />0 / {q.points} د</span>)}
                            </div>
                            <p className="text-sm ps-6">
                              <span className="text-slate-500">إجابة الطالب: </span>
                              <span className={auto ? (correct ? 'text-emerald-300' : 'text-red-300') : 'text-slate-200'} dir="auto">{ans || '— لم يجب —'}</span>
                            </p>
                            {auto && !correct && (
                              <p className="text-xs ps-6 text-emerald-400">الإجابة الصحيحة: {q.correct_answer}</p>
                            )}
                            {!auto && (
                              <div className="flex items-center gap-2 ps-6">
                                <label className="text-slate-400 text-xs">درجة هذا السؤال:</label>
                                <input
                                  type="number" min={0} max={q.points}
                                  value={essayPoints[sub.id]?.[q.id] ?? 0}
                                  onChange={e => setEssayPoints(p => ({
                                    ...p,
                                    [sub.id]: { ...(p[sub.id] ?? {}), [q.id]: Math.max(0, Math.min(q.points, Number(e.target.value))) },
                                  }))}
                                  className="w-20 px-2 py-1 rounded bg-slate-800 border border-slate-700 text-white text-sm text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                                <span className="text-slate-500 text-xs">من {q.points}</span>
                              </div>
                            )}
                          </div>
                        )
                      })}

                      <div className="flex items-center gap-3 flex-wrap pt-1">
                        {hasEssay && (
                          <>
                            <span className="text-slate-300 text-sm">
                              المجموع النهائي: <span className="text-white font-bold">{totalFor(hw, sub)} / {sub.max_score}</span>
                              <span className="text-slate-500 text-xs"> (آلي {autoScore(hw.questions, sub.answers)} + مقالي)</span>
                            </span>
                            <Button size="sm" loading={busy === sub.id}
                              onClick={() => patchSub(sub.id, { score: totalFor(hw, sub), grading_status: 'reviewing' })}>
                              <Save className="w-3.5 h-3.5" /> حفظ التصحيح
                            </Button>
                          </>
                        )}
                        {sub.grading_status !== 'published' ? (
                          <Button size="sm" variant="secondary" loading={busy === sub.id}
                            onClick={() => patchSub(sub.id, hasEssay
                              ? { score: totalFor(hw, sub), grading_status: 'published' }
                              : { grading_status: 'published' })}>
                            <Send className="w-3.5 h-3.5" /> نشر النتيجة للطالب
                          </Button>
                        ) : (
                          <Button size="sm" variant="ghost" loading={busy === sub.id}
                            onClick={() => patchSub(sub.id, { grading_status: 'reviewing' })}>
                            <EyeOff className="w-3.5 h-3.5" /> إخفاء النتيجة عن الطالب
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
