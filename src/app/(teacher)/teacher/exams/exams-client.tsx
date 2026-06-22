'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Plus, ClipboardList, Sparkles, Trash2, Eye, EyeOff, ShieldCheck, X } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import type { Question } from '@/types'

interface Exam { id: string; title: string; duration_minutes: number; questions: Question[]; is_published: boolean; proctoring_enabled: boolean; created_at: string; groups: { name: string } | null }
interface Group { id: string; name: string }
interface Props { initialExams: Exam[]; groups: Group[] }

export function ExamsClient({ initialExams, groups }: Props) {
  const [exams, setExams] = useState(initialExams)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ title: '', group_id: groups[0]?.id ?? '', duration_minutes: 60, proctoring_enabled: false })
  const [questions, setQuestions] = useState<Question[]>([])
  const [aiTopic, setAiTopic] = useState('')
  const [aiCount, setAiCount] = useState(10)
  const [aiLoading, setAiLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const supabase = createClient()

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
    const { data } = await supabase.from('exams').insert({
      ...form,
      questions,
    }).select('*, groups(name)').single()
    if (data) setExams(prev => [data, ...prev])
    setShowModal(false)
    setQuestions([])
    setLoading(false)
  }

  async function togglePublish(exam: Exam) {
    const { data } = await supabase.from('exams').update({ is_published: !exam.is_published }).eq('id', exam.id).select('*, groups(name)').single()
    if (data) setExams(prev => prev.map(e => e.id === exam.id ? data : e))
  }

  async function deleteExam(id: string) {
    if (!confirm('Delete this exam?')) return
    await supabase.from('exams').delete().eq('id', id)
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
        <Button onClick={() => { setForm({ title: '', group_id: groups[0]?.id ?? '', duration_minutes: 60, proctoring_enabled: false }); setQuestions([]); setShowModal(true) }}>
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
                  <p className="text-slate-400 text-sm">{exam.groups?.name ?? '—'} · {exam.duration_minutes} min · {exam.questions.length} questions · {formatDate(exam.created_at)}</p>
                </div>
                <div className="flex gap-1 shrink-0">
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
    </div>
  )
}
