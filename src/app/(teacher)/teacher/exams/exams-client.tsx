'use client'
import { confirmDialog } from '@/lib/confirm-dialog'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/components/ui/toast'
import { Plus, ClipboardList, Sparkles, Trash2, Eye, EyeOff, ShieldCheck, X, BarChart2, AlertTriangle, Users, ChevronDown, ChevronUp, CheckCircle2, XCircle, Save, Send, FileQuestion, Upload } from 'lucide-react'
import { formatDate, formatDateTime } from '@/lib/utils'
import { AiProgress } from '@/components/shared/ai-progress'
import { extractFilesText } from '@/lib/ai/extract-client'
import type { Question } from '@/types'

interface ResultRow {
  student_id: string; submission_id: string | null; name: string; email: string; submitted: boolean
  answers: Record<string, string>
  score: number | null; max_score: number; grading_status: string | null
  submitted_at: string | null; violations: number
}
interface ExamResults {
  title: string; group_name: string; max_score: number
  submitted_count: number; roster_count: number
  questions: Question[]
  results: ResultRow[]
}

const isAutoQ = (q: Question) => q.type === 'mcq' || q.type === 'true_false'
const isAutoCorrect = (q: Question, ans?: string) =>
  (ans ?? '').trim().toLowerCase() === (q.correct_answer ?? '').trim().toLowerCase()

interface Exam { id: string; title: string; duration_minutes: number; questions: Question[]; is_published: boolean; proctoring_enabled: boolean; created_at: string; groups: { name: string } | null }
interface Group { id: string; name: string }
interface Props { initialExams: Exam[]; groups: Group[]; proctoringDefault?: boolean }

export function ExamsClient({ initialExams, groups, proctoringDefault = false }: Props) {
  const router = useRouter()
  const [exams, setExams] = useState(initialExams)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ title: '', group_id: groups[0]?.id ?? '', duration_minutes: 60, proctoring_enabled: proctoringDefault })
  const [questions, setQuestions] = useState<Question[]>([])
  const [aiTopic, setAiTopic] = useState('')
  const [aiCount, setAiCount] = useState(10)
  const [aiLoading, setAiLoading] = useState(false)
  const [loading, setLoading] = useState(false)

  // ── AI from file — questions generated strictly from uploaded material
  //    (same source-restricted pipeline as homework/lesson generation) ──
  const [genMode, setGenMode] = useState<'topic' | 'file'>('topic')
  const [examFiles, setExamFiles] = useState<File[]>([])
  const examFileRef = useRef<HTMLInputElement>(null)
  const [examQTypes, setExamQTypes] = useState<Set<string>>(new Set(['mcq', 'true_false']))
  const [examTypePoints, setExamTypePoints] = useState<Record<string, number>>({ mcq: 1, true_false: 1, essay: 1 })
  const [examFileCount, setExamFileCount] = useState(10)
  const [examFileInstructions, setExamFileInstructions] = useState('')
  const [examFileLoading, setExamFileLoading] = useState(false)
  const [examFileError, setExamFileError] = useState('')

  function toggleExamQType(t: string) {
    setExamQTypes(prev => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  }

  async function generateExamFromFile() {
    if (examFiles.length === 0 || examQTypes.size === 0) return
    setExamFileLoading(true); setExamFileError('')
    try {
      const extracted = await extractFilesText(examFiles)
      if ('error' in extracted) { setExamFileError(extracted.error); setExamFileLoading(false); return }
      const fd = new FormData()
      fd.append('sourceText', extracted.combined)
      fd.append('types', [...examQTypes].join(','))
      fd.append('count', String(examFileCount))
      fd.append('instructions', examFileInstructions)
      fd.append('avoid', JSON.stringify(questions.map(q => q.text).slice(-100)))
      const res = await fetch('/api/ai/generate-homework-from-file', { method: 'POST', body: fd })
      const data = await res.json()
      if (res.ok && data.questions) {
        const withPoints = (data.questions as Question[]).map(q => ({
          ...q,
          points: examTypePoints[q.type] ?? q.points,
        }))
        setQuestions(prev => [...prev, ...withPoints])
        if (!form.title && examFiles[0]) setForm(p => ({ ...p, title: examFiles[0].name.replace(/\.\w+$/, '') }))
        if (data.delivered < data.requested) {
          setExamFileError(`تم توليد ${data.delivered} من ${data.requested} سؤالاً فريداً — محتوى الملف لا يكفي لأكثر من ذلك بدون تكرار. يمكنك التوليد مجدداً أو الإضافة يدوياً.`)
        }
      } else {
        setExamFileError(data.error ?? 'فشل التوليد')
      }
    } catch {
      setExamFileError('خطأ في الاتصال. حاول مجدداً.')
    }
    setExamFileLoading(false)
  }
  const [selectedQ, setSelectedQ] = useState<Set<string>>(new Set()) // bulk-grade selection
  const [bulkPts, setBulkPts] = useState(1)
  const [results, setResults] = useState<ExamResults | null>(null)
  const [resultsLoading, setResultsLoading] = useState(false)
  const [viewQuestions, setViewQuestions] = useState<Exam | null>(null)
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  // manual points per submission: { [submissionId]: { [questionId]: points } }
  const [manualPts, setManualPts] = useState<Record<string, Record<string, number>>>({})
  const [gradeBusy, setGradeBusy] = useState('')
  const [resultsExamId, setResultsExamId] = useState('')

  async function openResults(examId: string) {
    setResultsLoading(true); setResults(null); setExpandedRow(null); setManualPts({})
    setResultsExamId(examId)
    const res = await fetch(`/api/exams/results?exam_id=${examId}`)
    if (res.ok) setResults(await res.json())
    else toast.error((await res.json().catch(() => ({}))).error ?? 'Failed to load results')
    setResultsLoading(false)
  }

  // Auto-gradable portion of a submission (mcq/true_false), from stored answers.
  function autoScore(r: ResultRow): number {
    if (!results) return 0
    return results.questions.reduce((s, q) =>
      s + (isAutoQ(q) && isAutoCorrect(q, r.answers[q.id]) ? q.points : 0), 0)
  }
  function totalFor(r: ResultRow): number {
    if (!results || !r.submission_id) return 0
    const manual = manualPts[r.submission_id] ?? {}
    const manualSum = results.questions.filter(q => !isAutoQ(q))
      .reduce((s, q) => s + (manual[q.id] ?? 0), 0)
    return autoScore(r) + manualSum
  }

  // Reuses the generic submission PATCH (verifies exams.teacher_id server-side).
  async function patchSubmission(submissionId: string, patch: { score?: number; grading_status?: string }, examId: string) {
    setGradeBusy(submissionId)
    const res = await fetch('/api/homework/submissions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: submissionId, ...patch }),
    })
    if (!res.ok) toast.error((await res.json().catch(() => ({}))).error ?? 'فشل الحفظ')
    else await openResults(examId) // refresh scores/status
    setGradeBusy('')
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
    // Default every question to 1 point → a natural total = number of questions
    // (e.g. 30 questions ⇒ out of 30). The teacher can adjust each below.
    if (data.questions) setQuestions(data.questions.map((q: Question, i: number) => ({ ...q, id: String(i + 1), points: 1 })))
    setAiLoading(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (questions.length === 0) { toast.warning('Add at least one question'); return }
    setLoading(true)
    const res = await fetch('/api/exams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, questions }),
    })
    const data = await res.json()
    if (res.ok) { setExams(prev => [data, ...prev]); router.refresh() }
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
    if (res.ok) { setExams(prev => prev.map(e => e.id === exam.id ? data : e)); router.refresh() }
  }

  async function deleteExam(id: string) {
    if (!(await confirmDialog('حذف هذا الاختبار؟\n\nإن كان "الحذف النهائي" مفعّلاً من إعدادات المالك فسيُمحى نهائياً مع كل تسليماته وعلاماته (لا رجعة). وإلا فسيُنقل إلى الأرشيف مع حفظ كل السجلات.'))) return
    const res = await fetch('/api/exams', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (!res.ok) {
      toast.error((await res.json().catch(() => ({}))).error ?? 'فشل حذف الاختبار')
      return
    }
    setExams(prev => prev.filter(e => e.id !== id))
    router.refresh()
  }

  function removeQuestion(id: string) {
    setQuestions(prev => prev.filter(q => q.id !== id))
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-fg">Exams</h2>
          <p className="text-fg-secondary mt-1">{exams.length} exams created</p>
        </div>
        <Button onClick={() => { setForm({ title: '', group_id: groups[0]?.id ?? '', duration_minutes: 60, proctoring_enabled: proctoringDefault }); setQuestions([]); setSelectedQ(new Set()); setExamFiles([]); setExamFileError(''); setGenMode('topic'); setShowModal(true) }}>
          <Plus className="w-4 h-4" /> New Exam
        </Button>
      </div>

      {exams.length === 0 ? (
        <div className="text-center py-20 bg-surface border border-border rounded-lg">
          <ClipboardList className="w-12 h-12 text-fg-muted mx-auto mb-3" />
          <p className="text-fg-secondary">No exams yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {exams.map(exam => (
            <div key={exam.id} className="bg-surface border border-border rounded-lg p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="text-fg font-semibold">{exam.title}</h3>
                    <Badge variant={exam.is_published ? 'success' : 'neutral'}>{exam.is_published ? 'Published' : 'Draft'}</Badge>
                    {exam.proctoring_enabled && <Badge variant="info"><ShieldCheck className="w-3 h-3 mr-1" />Proctored</Badge>}
                  </div>
                  <p className="text-fg-secondary text-sm flex items-center gap-1.5 flex-wrap">
                    <Users className="w-3.5 h-3.5" /> <span className="text-fg-secondary">{exam.groups?.name ?? '—'}</span>
                    · {exam.duration_minutes} min · {exam.questions.length} questions · {formatDate(exam.created_at)}
                  </p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button variant="ghost" size="sm" onClick={() => setViewQuestions(exam)} title="عرض الأسئلة"><FileQuestion className="w-4 h-4" /></Button>
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
          {/* AI Generator — from a topic, or from the teacher's own files */}
          <div className="flex rounded-lg border border-border-strong overflow-hidden w-fit">
            <button type="button" onClick={() => setGenMode('topic')}
              className={`px-4 py-2 text-sm font-medium transition-colors ${genMode === 'topic' ? 'bg-accent text-accent-fg' : 'bg-surface text-fg-secondary hover:text-fg'}`}>
              من عنوان
            </button>
            <button type="button" onClick={() => setGenMode('file')}
              className={`px-4 py-2 text-sm font-medium transition-colors ${genMode === 'file' ? 'bg-accent text-accent-fg' : 'bg-surface text-fg-secondary hover:text-fg'}`}>
              من ملفات
            </button>
          </div>

          {genMode === 'topic' ? (
            <div className="bg-accent-subtle border border-accent/20 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-accent" />
                <span className="text-accent text-sm font-medium">AI Question Generator</span>
              </div>
              <div className="flex gap-2">
                <input value={aiTopic} onChange={e => setAiTopic(e.target.value)} placeholder="Topic (e.g. Database Normalization)" className="flex-1 px-3 py-2 rounded-lg bg-surface border border-border-strong text-fg placeholder-fg-muted text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
                <input type="number" value={aiCount} onChange={e => setAiCount(Number(e.target.value))} min={5} max={30} className="w-16 px-3 py-2 rounded-lg bg-surface border border-border-strong text-fg text-sm text-center focus:outline-none focus:ring-2 focus:ring-violet-500" />
                <Button onClick={generateQuestions} loading={aiLoading} variant="secondary" size="sm">Generate</Button>
              </div>
            </div>
          ) : (
            <div className="bg-accent-subtle border border-accent/30 rounded-lg p-4 space-y-3" dir="rtl">
              <div className="flex items-center gap-2">
                <Upload className="w-4 h-4 text-accent" />
                <span className="text-accent-hover text-sm font-medium">توليد اختبار من ملف — الأسئلة من محتوى الملف فقط</span>
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => examFileRef.current?.click()}
                    className="px-3 py-2 rounded-lg border border-accent bg-accent-subtle text-accent-hover text-sm hover:bg-accent-hover/20 transition-colors">
                    <Plus className="w-3.5 h-3.5 inline -mt-0.5" /> {examFiles.length ? 'إضافة ملفات أخرى' : 'اختر ملفاً أو أكثر (PDF / DOCX / PPTX / صورة)'}
                  </button>
                  <input ref={examFileRef} type="file" multiple accept=".pptx,.docx,.pdf,.jpg,.jpeg,.png,.webp" className="hidden"
                    onChange={e => {
                      const picked = Array.from(e.target.files ?? [])
                      setExamFiles(prev => {
                        const seen = new Set(prev.map(f => f.name + f.size))
                        return [...prev, ...picked.filter(f => !seen.has(f.name + f.size))].slice(0, 10)
                      })
                      setExamFileError('')
                      e.target.value = ''
                    }} />
                  <input type="number" value={examFileCount} onChange={e => setExamFileCount(Number(e.target.value))} min={1} max={120}
                    title="عدد الأسئلة"
                    className="w-16 px-3 py-2 rounded-lg bg-surface border border-border-strong text-fg text-sm text-center focus:outline-none focus:ring-2 focus:ring-accent" />
                  <span className="text-fg-muted text-xs">سؤال</span>
                </div>
                {examFiles.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {examFiles.map((f, i) => (
                      <span key={f.name + f.size} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface border border-border-strong text-fg-secondary text-xs">
                        📄 {f.name}
                        <button type="button" title="إزالة هذا الملف"
                          onClick={() => setExamFiles(prev => prev.filter((_, j) => j !== i))}
                          className="text-fg-muted hover:text-red-400"><X className="w-3 h-3" /></button>
                      </span>
                    ))}
                    <span className="text-fg-muted text-xs self-center">{examFiles.length}/10</span>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {([['mcq', 'اختيار من متعدد'], ['true_false', 'صح / خطأ'], ['essay', 'مقالي']] as const).map(([t, label]) => (
                    <div key={t} className="flex items-center gap-1.5">
                      <button type="button" onClick={() => toggleExamQType(t)}
                        className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                          examQTypes.has(t) ? 'border-accent bg-accent-subtle text-accent-hover' : 'border-border-strong text-fg-secondary hover:border-border-strong'
                        }`}>
                        {examQTypes.has(t) ? '✓ ' : ''}{label}
                      </button>
                      {examQTypes.has(t) && (
                        <>
                          <input type="number" min={1} max={100} value={examTypePoints[t]}
                            title={`علامة كل سؤال ${label}`}
                            onChange={e => setExamTypePoints(p => ({ ...p, [t]: Math.max(1, Number(e.target.value)) }))}
                            className="w-14 px-2 py-1.5 rounded-lg bg-surface border border-border-strong text-fg text-sm text-center focus:outline-none focus:ring-1 focus:ring-accent" />
                          <span className="text-fg-muted text-xs">علامة</span>
                        </>
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-fg-muted text-xs">حدد علامة كل سؤال حسب نوعه — وبعد التوليد يمكنك تعديل علامة أي سؤال منفرداً أو جماعياً.</p>
              </div>

              <textarea value={examFileInstructions} onChange={e => setExamFileInstructions(e.target.value)} rows={2}
                className="w-full px-3 py-2 rounded-lg bg-surface border border-border-strong text-fg text-sm resize-none focus:outline-none focus:ring-1 focus:ring-accent"
                placeholder='تعليمات إضافية للذكاء الاصطناعي (اختياري) — مثال: "ركّز على الفصلين 3 و4"' />

              <AiProgress active={examFileLoading} />
              {examFileError && <p className="text-red-400 text-sm">{examFileError}</p>}

              <Button onClick={generateExamFromFile} loading={examFileLoading} disabled={examFiles.length === 0 || examQTypes.size === 0} variant="secondary" size="sm">
                <Sparkles className="w-4 h-4" /> توليد الأسئلة من الملف
              </Button>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input label="Exam Title" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} required placeholder="Midterm Exam - Chapter 1-5" />
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-fg-secondary">Group</label>
                <select value={form.group_id} onChange={e => setForm(p => ({ ...p, group_id: e.target.value }))} className="w-full px-4 py-2.5 rounded-lg bg-surface border border-border-strong text-fg text-sm focus:outline-none focus:ring-2 focus:ring-accent">
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
              <Input label="Duration (minutes)" type="number" value={form.duration_minutes} onChange={e => setForm(p => ({ ...p, duration_minutes: Number(e.target.value) }))} min={5} />
            </div>
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <div onClick={() => setForm(p => ({ ...p, proctoring_enabled: !p.proctoring_enabled }))} className={`relative w-10 h-5 rounded-full transition-colors ${form.proctoring_enabled ? 'bg-accent' : 'bg-canvas'}`}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${form.proctoring_enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </div>
              <span className="text-fg-secondary text-sm flex items-center gap-1.5"><ShieldCheck className="w-4 h-4 text-accent" />Enable Proctoring (camera + tab detection)</span>
            </label>

            {/* Questions Preview */}
            {questions.length > 0 && (
              <div className="space-y-2">
                <p className="text-fg-secondary text-sm font-medium">{questions.length} Questions Generated</p>

                {/* Bulk-grade bar: set a uniform mark for selected (or all) questions
                    at once — no need to edit 100 questions one by one. */}
                <div className="flex flex-wrap items-center gap-2 bg-surface/60 border border-border-strong rounded-lg px-3 py-2" dir="rtl">
                  <button type="button"
                    onClick={() => setSelectedQ(selectedQ.size === questions.length ? new Set() : new Set(questions.map(q => q.id)))}
                    className="text-xs px-2 py-1 rounded border border-border-strong text-fg-secondary hover:text-fg hover:border-border-strong">
                    {selectedQ.size === questions.length ? 'إلغاء تحديد الكل' : 'تحديد الكل'}
                  </button>
                  <span className="text-fg-secondary text-xs">
                    {selectedQ.size > 0 ? `${selectedQ.size} محدد` : 'حدّد أسئلة'} — ضع درجة موحّدة:
                  </span>
                  <input type="number" min={1} max={100} value={bulkPts}
                    onChange={e => setBulkPts(Math.max(1, Number(e.target.value)))}
                    className="w-16 px-2 py-1 rounded bg-surface border border-border-strong text-fg text-xs text-center focus:outline-none focus:ring-1 focus:ring-accent" />
                  <Button type="button" size="sm" variant="secondary"
                    onClick={() => {
                      const target = selectedQ.size > 0 ? selectedQ : new Set(questions.map(q => q.id))
                      setQuestions(prev => prev.map(x => target.has(x.id) ? { ...x, points: bulkPts } : x))
                    }}>
                    تطبيق {selectedQ.size > 0 ? 'على المحدد' : 'على الكل'}
                  </Button>
                </div>

                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {questions.map((q, i) => {
                    const sel = selectedQ.has(q.id)
                    return (
                      <div key={q.id} className={`flex items-start gap-3 rounded-lg p-3 border ${sel ? 'bg-accent/10 border-accent/30' : 'bg-surface border-transparent'}`}>
                        <input type="checkbox" checked={sel}
                          onChange={() => setSelectedQ(prev => { const n = new Set(prev); if (n.has(q.id)) n.delete(q.id); else n.add(q.id); return n })}
                          className="mt-1 accent-blue-500 shrink-0" />
                        <span className="text-fg-muted text-xs font-mono mt-0.5">{i + 1}.</span>
                        <p className="text-fg-secondary text-sm flex-1 line-clamp-2">{q.text}</p>
                        <Badge variant={q.type === 'mcq' ? 'info' : q.type === 'true_false' ? 'warning' : 'neutral'} className="shrink-0">{q.type}</Badge>
                        <span className="flex items-center gap-1 shrink-0">
                          <input type="number" min={1} max={100} value={q.points}
                            title="درجة هذا السؤال"
                            onChange={e => {
                              const v = Math.max(1, Number(e.target.value))
                              setQuestions(prev => prev.map(x => x.id === q.id ? { ...x, points: v } : x))
                            }}
                            className="w-14 px-1.5 py-1 rounded bg-surface border border-border-strong text-fg text-xs text-center focus:outline-none focus:ring-1 focus:ring-accent" />
                          <span className="text-fg-muted text-xs">د</span>
                        </span>
                        <button onClick={() => removeQuestion(q.id)} className="text-fg-muted hover:text-red-400 shrink-0"><X className="w-3.5 h-3.5" /></button>
                      </div>
                    )
                  })}
                </div>
                <p className="text-fg-secondary text-xs mt-2">
                  {questions.length} سؤالاً · العلامة الكاملة: <span className="text-fg font-bold">{questions.reduce((s, q) => s + (q.points || 0), 0)}</span>
                  <span className="text-fg-muted"> — عدّل فردياً أو حدّد أسئلة وضع درجة موحّدة</span>
                </p>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button type="button" variant="secondary" onClick={() => setShowModal(false)} className="flex-1">Cancel</Button>
              <Button type="submit" loading={loading} className="flex-1">Create Exam ({questions.reduce((s, q) => s + (q.points || 0), 0)} د)</Button>
            </div>
          </form>
        </div>
      </Modal>

      {/* Results */}
      <Modal open={resultsLoading || !!results} onClose={() => setResults(null)} title="Exam Results" size="xl">
        {resultsLoading ? (
          <p className="text-fg-muted text-sm py-8 text-center">Loading results...</p>
        ) : results ? (
          <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <p className="text-fg font-semibold">{results.title}</p>
                <p className="text-fg-secondary text-sm flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> {results.group_name}</p>
              </div>
              <div className="ms-auto flex gap-4 text-sm">
                <span className="text-fg-secondary">{results.submitted_count}/{results.roster_count} submitted</span>
                <span className="text-fg-muted">out of {results.max_score} marks</span>
              </div>
            </div>

            {results.results.length === 0 ? (
              <p className="text-fg-muted text-sm py-6 text-center">No students enrolled in this group yet.</p>
            ) : (
              <div className="border border-border rounded-lg">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-fg-secondary text-xs uppercase tracking-wider">
                      <th className="text-left px-4 py-2.5">Student</th>
                      <th className="text-left px-4 py-2.5">Score</th>
                      <th className="text-left px-4 py-2.5 hidden sm:table-cell">Submitted</th>
                      <th className="text-left px-4 py-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70">
                    {results.results.map(r => {
                      const pct = r.submitted && r.score != null ? Math.round((r.score / (r.max_score || 1)) * 100) : null
                      const open = expandedRow === r.student_id
                      const hasManualQ = results.questions.some(q => !isAutoQ(q))
                      return (
                        <>
                          <tr key={r.student_id}
                            onClick={() => r.submitted && setExpandedRow(open ? null : r.student_id)}
                            className={`hover:bg-surface/40 ${r.submitted ? 'cursor-pointer' : ''}`}>
                            <td className="px-4 py-3">
                              <p className="text-fg flex items-center gap-1.5">
                                {r.name}
                                {r.submitted && (open ? <ChevronUp className="w-3.5 h-3.5 text-fg-muted" /> : <ChevronDown className="w-3.5 h-3.5 text-fg-muted" />)}
                              </p>
                              <p className="text-fg-muted text-xs">{r.email}</p>
                            </td>
                            <td className="px-4 py-3">
                              {!r.submitted ? <span className="text-fg-muted">—</span>
                                : r.grading_status === 'published' && r.score != null
                                  ? <span className={`font-bold ${pct! >= 60 ? 'text-accent' : 'text-red-400'}`}>{r.score}/{r.max_score} ({pct}%)</span>
                                  : <span className="text-accent text-xs">pending grading</span>}
                            </td>
                            <td className="px-4 py-3 hidden sm:table-cell text-fg-secondary text-xs">{r.submitted_at ? formatDateTime(r.submitted_at) : '—'}</td>
                            <td className="px-4 py-3">
                              {!r.submitted ? <Badge variant="neutral">Not taken</Badge>
                                : <span className="flex items-center gap-2">
                                    <Badge variant="success">Submitted</Badge>
                                    {r.violations > 0 && <span className="flex items-center gap-1 text-red-400 text-xs"><AlertTriangle className="w-3.5 h-3.5" />{r.violations}</span>}
                                  </span>}
                            </td>
                          </tr>

                          {/* Expanded: answers review + manual grading */}
                          {open && r.submitted && r.submission_id && (
                            <tr key={`${r.student_id}-detail`}>
                              <td colSpan={4} className="px-4 py-4 bg-canvas/50">
                                <div className="space-y-3" dir="rtl">
                                  {results.questions.map((q, qi) => {
                                    const ans = r.answers[q.id] ?? ''
                                    const auto = isAutoQ(q)
                                    const correct = auto && isAutoCorrect(q, ans)
                                    return (
                                      <div key={q.id} className="rounded-lg border border-border p-3 space-y-1.5 text-start">
                                        <div className="flex items-start gap-2">
                                          <span className="text-fg-muted text-xs font-mono mt-0.5">{qi + 1}.</span>
                                          <p className="flex-1 text-fg text-sm">{q.text}</p>
                                          {auto && (correct
                                            ? <span className="flex items-center gap-1 text-accent text-xs shrink-0"><CheckCircle2 className="w-3.5 h-3.5" />{q.points} د</span>
                                            : <span className="flex items-center gap-1 text-red-400 text-xs shrink-0"><XCircle className="w-3.5 h-3.5" />0/{q.points} د</span>)}
                                        </div>
                                        <p className="text-sm ps-6">
                                          <span className="text-fg-muted">إجابة الطالب: </span>
                                          <span className={auto ? (correct ? 'text-success' : 'text-error') : 'text-fg'} dir="auto">{ans || '— لم يجب —'}</span>
                                        </p>
                                        {auto && !correct && <p className="text-xs ps-6 text-accent">الإجابة الصحيحة: {q.correct_answer}</p>}
                                        {!auto && (
                                          <div className="flex items-center gap-2 ps-6">
                                            <label className="text-fg-secondary text-xs">درجة هذا السؤال:</label>
                                            <input type="number" min={0} max={q.points}
                                              value={manualPts[r.submission_id!]?.[q.id] ?? 0}
                                              onChange={e => setManualPts(p => ({
                                                ...p,
                                                [r.submission_id!]: { ...(p[r.submission_id!] ?? {}), [q.id]: Math.max(0, Math.min(q.points, Number(e.target.value))) },
                                              }))}
                                              className="w-20 px-2 py-1 rounded bg-surface border border-border-strong text-fg text-sm text-center focus:outline-none focus:ring-1 focus:ring-accent" />
                                            <span className="text-fg-muted text-xs">من {q.points}</span>
                                          </div>
                                        )}
                                      </div>
                                    )
                                  })}

                                  <div className="flex items-center gap-3 flex-wrap pt-1">
                                    {hasManualQ && (
                                      <>
                                        <span className="text-fg-secondary text-sm">
                                          المجموع النهائي: <span className="text-fg font-bold">{totalFor(r)} / {r.max_score}</span>
                                          <span className="text-fg-muted text-xs"> (آلي {autoScore(r)} + يدوي)</span>
                                        </span>
                                        <Button size="sm" loading={gradeBusy === r.submission_id}
                                          onClick={() => patchSubmission(r.submission_id!, { score: totalFor(r), grading_status: 'reviewing' }, resultsExamId)}>
                                          <Save className="w-3.5 h-3.5" /> حفظ التصحيح
                                        </Button>
                                      </>
                                    )}
                                    {r.grading_status !== 'published' ? (
                                      <Button size="sm" variant="secondary" loading={gradeBusy === r.submission_id}
                                        onClick={() => patchSubmission(r.submission_id!, hasManualQ
                                          ? { score: totalFor(r), grading_status: 'published' }
                                          : { grading_status: 'published' }, resultsExamId)}>
                                        <Send className="w-3.5 h-3.5" /> نشر النتيجة للطالب
                                      </Button>
                                    ) : (
                                      <Button size="sm" variant="ghost" loading={gradeBusy === r.submission_id}
                                        onClick={() => patchSubmission(r.submission_id!, { grading_status: 'reviewing' }, resultsExamId)}>
                                        <EyeOff className="w-3.5 h-3.5" /> إخفاء النتيجة عن الطالب
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}
      </Modal>

      {/* Questions viewer — teacher reviews the exam content after creation */}
      <Modal open={!!viewQuestions} onClose={() => setViewQuestions(null)} title={viewQuestions ? `أسئلة: ${viewQuestions.title}` : ''} size="xl">
        {viewQuestions && (
          <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1" dir="rtl">
            <p className="text-fg-secondary text-sm">{viewQuestions.questions.length} سؤالاً · العلامة الكاملة: <span className="text-fg font-bold">{viewQuestions.questions.reduce((s, q) => s + (q.points || 0), 0)}</span></p>
            {viewQuestions.questions.map((q, i) => (
              <div key={q.id} className="rounded-lg border border-border bg-surface p-4 space-y-2 text-start">
                <div className="flex items-start gap-2">
                  <span className="text-fg-muted text-xs font-mono mt-0.5">{i + 1}.</span>
                  <p className="flex-1 text-fg text-sm">{q.text}</p>
                  <Badge variant={q.type === 'mcq' ? 'info' : q.type === 'true_false' ? 'warning' : 'neutral'}>{q.type}</Badge>
                  <span className="text-fg-muted text-xs shrink-0">{q.points} د</span>
                </div>
                {q.options && q.options.length > 0 && (
                  <ul className="ps-6 space-y-1">
                    {q.options.map((opt, j) => (
                      <li key={j} className={`text-sm flex items-center gap-1.5 ${opt === q.correct_answer ? 'text-accent font-medium' : 'text-fg-secondary'}`}>
                        {opt === q.correct_answer && <CheckCircle2 className="w-3.5 h-3.5" />}{opt}
                      </li>
                    ))}
                  </ul>
                )}
                {(!q.options || q.options.length === 0) && q.correct_answer && (
                  <p className="ps-6 text-accent text-sm">الإجابة: {q.correct_answer}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  )
}
