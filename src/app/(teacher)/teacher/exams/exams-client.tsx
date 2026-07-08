'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Plus, ClipboardList, Sparkles, Trash2, Eye, EyeOff, ShieldCheck, X, BarChart2, AlertTriangle, Users } from 'lucide-react'
import { formatDate, formatDateTime } from '@/lib/utils'
import type { Question } from '@/types'

interface ResultRow {
  student_id: string; name: string; email: string; submitted: boolean
  score: number | null; max_score: number; grading_status: string | null
  submitted_at: string | null; violations: number
}
interface ExamResults {
  title: string; group_name: string; max_score: number
  submitted_count: number; roster_count: number; results: ResultRow[]
}

interface Exam { id: string; title: string; duration_minutes: number; questions: Question[]; is_published: boolean; proctoring_enabled: boolean; created_at: string; groups: { name: string } | null }
interface Group { id: string; name: string }
interface Props { initialExams: Exam[]; groups: Group[]; proctoringDefault?: boolean }

export function ExamsClient({ initialExams, groups, proctoringDefault = false }: Props) {
  const [exams, setExams] = useState(initialExams)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ title: '', group_id: groups[0]?.id ?? '', duration_minutes: 60, proctoring_enabled: proctoringDefault })
  const [questions, setQuestions] = useState<Question[]>([])
  const [aiTopic, setAiTopic] = useState('')
  const [aiCount, setAiCount] = useState(10)
  const [aiLoading, setAiLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<ExamResults | null>(null)
  const [resultsLoading, setResultsLoading] = useState(false)

  async function openResults(examId: string) {
    setResultsLoading(true); setResults(null)
    const res = await fetch(`/api/exams/results?exam_id=${examId}`)
    if (res.ok) setResults(await res.json())
    else alert((await res.json().catch(() => ({}))).error ?? 'Failed to load results')
    setResultsLoading(false)
  }
  async function generateQuestions() {
    if (!aiTopic) return
    setAiLoading(true)
    const res = await fetch('/api/ai/generate-exam', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: aiTopic, count: aiCount, type: 'mixed' }),
    })
    const data = await res.json()
    if (data.questions) setQuestions(data.questions.map((q: Question, i: number) => ({ ...q, id: String(i + 1) })))
    setAiLoading(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (questions.length === 0) { alert('Add at least one question'); return }
    setLoading(true)
    const res = await fetch('/api/exams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, questions }),
    })
    const data = await res.json()
    if (res.ok) setExams(prev => [data, ...prev])
    setShowModal(false)
    setQuestions([])
    setLoading(false)
  }

  async function togglePublish(exam: Exam) {
    const res = await fetch('/api/exams', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: exam.id, is_published: !exam.is_published }),
    })
    const data = await res.json()
    if (res.ok) setExams(prev => prev.map(e => e.id === exam.id ? data : e))
  }

  async function deleteExam(id: string) {
    if (!confirm('حذف هذا الاختبار؟\n\nيُنقل إلى الأرشيف مع كل تسليماته وعلاماته — لا شيء يُمحى نهائياً ويمكن الرجوع إليه من أرشيف الجامعة.')) return
    const res = await fetch('/api/exams', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (!res.ok) {
      alert((await res.json().catch(() => ({}))).error ?? 'فشل حذف الاختبار')
      return
    }
    setExams(prev => prev.filter(e => e.id !== id))
  }

  function removeQuestion(id: string) {
    setQuestions(prev => prev.filter(q => q.id !== id))
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Exams</h2>
          <p className="text-slate-400 mt-1">{exams.length} exams created</p>
        </div>
        <Button onClick={() => { setForm({ title: '', group_id: groups[0]?.id ?? '', duration_minutes: 60, proctoring_enabled: proctoringDefault }); setQuestions([]); setShowModal(true) }}>
          <Plus className="w-4 h-4" /> New Exam
        </Button>
      </div>

      {exams.length === 0 ? (
        <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl">
          <ClipboardList className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">No exams yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {exams.map(exam => (
            <div key={exam.id} className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="text-white font-semibold">{exam.title}</h3>
                    <Badge variant={exam.is_published ? 'green' : 'gray'}>{exam.is_published ? 'Published' : 'Draft'}</Badge>
                    {exam.proctoring_enabled && <Badge variant="blue"><ShieldCheck className="w-3 h-3 mr-1" />Proctored</Badge>}
                  </div>
                  <p className="text-slate-400 text-sm flex items-center gap-1.5 flex-wrap">
                    <Users className="w-3.5 h-3.5" /> <span className="text-slate-300">{exam.groups?.name ?? '—'}</span>
                    · {exam.duration_minutes} min · {exam.questions.length} questions · {formatDate(exam.created_at)}
                  </p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button variant="secondary" size="sm" onClick={() => openResults(exam.id)}><BarChart2 className="w-4 h-4" /> Results</Button>
                  <Button variant="ghost" size="sm" onClick={() => togglePublish(exam)}>{exam.is_published ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</Button>
                  <Button variant="ghost" size="sm" onClick={() => deleteExam(exam.id)} className="hover:text-red-400 hover:bg-red-500/10"><Trash2 className="w-4 h-4" /></Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Create New Exam" size="xl">
        <div className="space-y-5 max-h-[70vh] overflow-y-auto pr-1">
          {/* AI Generator */}
          <div className="bg-violet-500/10 border border-violet-500/20 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-violet-400" />
              <span className="text-violet-400 text-sm font-medium">AI Question Generator</span>
            </div>
            <div className="flex gap-2">
              <input value={aiTopic} onChange={e => setAiTopic(e.target.value)} placeholder="Topic (e.g. Database Normalization)" className="flex-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
              <input type="number" value={aiCount} onChange={e => setAiCount(Number(e.target.value))} min={5} max={30} className="w-16 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm text-center focus:outline-none focus:ring-2 focus:ring-violet-500" />
              <Button onClick={generateQuestions} loading={aiLoading} variant="secondary" size="sm">Generate</Button>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input label="Exam Title" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} required placeholder="Midterm Exam - Chapter 1-5" />
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-300">Group</label>
                <select value={form.group_id} onChange={e => setForm(p => ({ ...p, group_id: e.target.value }))} className="w-full px-4 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
              <Input label="Duration (minutes)" type="number" value={form.duration_minutes} onChange={e => setForm(p => ({ ...p, duration_minutes: Number(e.target.value) }))} min={5} />
            </div>
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <div onClick={() => setForm(p => ({ ...p, proctoring_enabled: !p.proctoring_enabled }))} className={`relative w-10 h-5 rounded-full transition-colors ${form.proctoring_enabled ? 'bg-blue-600' : 'bg-slate-700'}`}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${form.proctoring_enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </div>
              <span className="text-slate-300 text-sm flex items-center gap-1.5"><ShieldCheck className="w-4 h-4 text-blue-400" />Enable Proctoring (camera + tab detection)</span>
            </label>

            {/* Questions Preview */}
            {questions.length > 0 && (
              <div className="space-y-2">
                <p className="text-slate-300 text-sm font-medium">{questions.length} Questions Generated</p>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {questions.map((q, i) => (
                    <div key={q.id} className="flex items-start gap-3 bg-slate-800 rounded-lg p-3">
                      <span className="text-slate-500 text-xs font-mono mt-0.5">{i + 1}.</span>
                      <p className="text-slate-300 text-sm flex-1 line-clamp-2">{q.text}</p>
                      <Badge variant={q.type === 'mcq' ? 'blue' : q.type === 'true_false' ? 'yellow' : 'gray'} className="shrink-0">{q.type}</Badge>
                      <button onClick={() => removeQuestion(q.id)} className="text-slate-500 hover:text-red-400 shrink-0"><X className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button type="button" variant="secondary" onClick={() => setShowModal(false)} className="flex-1">Cancel</Button>
              <Button type="submit" loading={loading} className="flex-1">Create Exam ({questions.length} Q)</Button>
            </div>
          </form>
        </div>
      </Modal>

      {/* Results */}
      <Modal open={resultsLoading || !!results} onClose={() => setResults(null)} title="Exam Results" size="xl">
        {resultsLoading ? (
          <p className="text-slate-500 text-sm py-8 text-center">Loading results...</p>
        ) : results ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <p className="text-white font-semibold">{results.title}</p>
                <p className="text-slate-400 text-sm flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> {results.group_name}</p>
              </div>
              <div className="ms-auto flex gap-4 text-sm">
                <span className="text-slate-300">{results.submitted_count}/{results.roster_count} submitted</span>
                <span className="text-slate-500">out of {results.max_score} marks</span>
              </div>
            </div>

            {results.results.length === 0 ? (
              <p className="text-slate-500 text-sm py-6 text-center">No students enrolled in this group yet.</p>
            ) : (
              <div className="border border-slate-800 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 text-xs uppercase tracking-wider">
                      <th className="text-left px-4 py-2.5">Student</th>
                      <th className="text-left px-4 py-2.5">Score</th>
                      <th className="text-left px-4 py-2.5 hidden sm:table-cell">Submitted</th>
                      <th className="text-left px-4 py-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {results.results.map(r => {
                      const pct = r.submitted && r.score != null ? Math.round((r.score / (r.max_score || 1)) * 100) : null
                      return (
                        <tr key={r.student_id} className="hover:bg-slate-800/40">
                          <td className="px-4 py-3">
                            <p className="text-white">{r.name}</p>
                            <p className="text-slate-500 text-xs">{r.email}</p>
                          </td>
                          <td className="px-4 py-3">
                            {!r.submitted ? <span className="text-slate-600">—</span>
                              : r.grading_status === 'published' && r.score != null
                                ? <span className={`font-bold ${pct! >= 60 ? 'text-emerald-400' : 'text-red-400'}`}>{r.score}/{r.max_score} ({pct}%)</span>
                                : <span className="text-amber-400 text-xs">pending grading</span>}
                          </td>
                          <td className="px-4 py-3 hidden sm:table-cell text-slate-400 text-xs">{r.submitted_at ? formatDateTime(r.submitted_at) : '—'}</td>
                          <td className="px-4 py-3">
                            {!r.submitted ? <Badge variant="gray">Not taken</Badge>
                              : <span className="flex items-center gap-2">
                                  <Badge variant="green">Submitted</Badge>
                                  {r.violations > 0 && <span className="flex items-center gap-1 text-red-400 text-xs"><AlertTriangle className="w-3.5 h-3.5" />{r.violations}</span>}
                                </span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
