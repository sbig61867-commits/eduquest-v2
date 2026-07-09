'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  ArrowLeft, BookOpen, ClipboardList, Users, Sparkles, Upload,
  FileText, Plus, Trash2, Download, Check, X, Eye, EyeOff
} from 'lucide-react'
import { LessonTabs } from '@/components/shared/lesson-tabs'
import { AiProgress } from '@/components/shared/ai-progress'
import { SubmissionsTab } from './submissions-tab'
import { Modal } from '@/components/ui/modal'

interface Lesson {
  id: string; title: string; content: string | null; is_published: boolean
  groups: { id: string; name: string } | null
}
interface HomeworkItem {
  id: string; title: string; is_published: boolean
  questions: Question[]; ends_at: string | null
  exam_submissions: { count: number }[]
}
interface Question {
  id: string; text: string; type: 'mcq' | 'true_false' | 'essay'
  options: string[]; correct_answer: string; points: number
}
interface Group { id: string; name: string }

interface Props {
  lesson: Lesson
  initialHomework: HomeworkItem[]
  groups: Group[]
}

const TABS = ['المحتوى', 'الواجب', 'التسليمات'] as const
type Tab = typeof TABS[number]

export function LessonDetailClient({ lesson, initialHomework }: Props) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('المحتوى')

  // ── Content tab ──
  const [content, setContent] = useState(lesson.content ?? '')
  const [title, setTitle] = useState(lesson.title)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [published, setPublished] = useState(lesson.is_published)
  const [publishing, setPublishing] = useState(false)

  async function togglePublish() {
    setPublishing(true)
    const res = await fetch('/api/lessons', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: lesson.id, is_published: !published }),
    })
    if (res.ok) {
      setPublished(p => !p)
      router.refresh()
    } else {
      alert((await res.json().catch(() => ({}))).error ?? 'فشل تغيير حالة النشر')
    }
    setPublishing(false)
  }

  // Content preview
  // Default to preview when the lesson already has content, so the teacher
  // lands on the same tabbed view the student sees; "تحرير" switches to raw.
  const [previewMode, setPreviewMode] = useState(() => !!(lesson.content ?? '').trim())

  // AI from file
  const [fileMode, setFileMode] = useState(false)
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [aiLevel, setAiLevel] = useState('undergraduate')
  const [aiInstructions, setAiInstructions] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  // ── Homework tab ──
  const [homework, setHomework] = useState(initialHomework)
  const [showHwModal, setShowHwModal] = useState(false)
  const [hwForm, setHwForm] = useState({ title: '', due_date: '' })
  const [autoPublishHw, setAutoPublishHw] = useState(true)
  const [questions, setQuestions] = useState<Question[]>([])
  const [hwLoading, setHwLoading] = useState(false)
  const [aiHwTopic, setAiHwTopic] = useState('')
  const [aiHwCount, setAiHwCount] = useState(5)
  const [aiHwLoading, setAiHwLoading] = useState(false)

  // Homework from file
  const [hwFiles, setHwFiles] = useState<File[]>([])
  const [hwTypes, setHwTypes] = useState<Set<string>>(new Set(['mcq', 'true_false']))
  // Teacher-set default points per question type — applied to every
  // generated question; each question stays individually editable after.
  const [typePoints, setTypePoints] = useState<Record<string, number>>({ mcq: 1, true_false: 1, essay: 5 })
  const [hwFileCount, setHwFileCount] = useState(10)
  const [hwFileInstructions, setHwFileInstructions] = useState('')
  const [hwFileLoading, setHwFileLoading] = useState(false)
  const [hwFileError, setHwFileError] = useState('')
  const hwFileRef = useRef<HTMLInputElement>(null)

  // New manual question form
  const [newQ, setNewQ] = useState<Partial<Question>>({ type: 'mcq', options: ['', '', '', ''], points: 5 })
  const [showAddQ, setShowAddQ] = useState(false)

  // ── Save lesson content ──
  async function saveContent() {
    setSaving(true)
    await fetch('/api/lessons', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: lesson.id, title, content }),
    })
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  // ── AI from file ──
  const QTYPE_OPTIONS = [
    { key: 'true_false', label: 'صح / خطأ' },
    { key: 'mcq', label: 'اختيار من متعدد' },
    { key: 'essay', label: 'مقالي' },
  ] as const
  const [qTypes, setQTypes] = useState<string[]>(['true_false', 'mcq'])

  function toggleQType(key: string) {
    setQTypes(prev => prev.includes(key)
      ? (prev.length > 1 ? prev.filter(t => t !== key) : prev) // keep at least one
      : [...prev, key])
  }

  async function generateFromFile() {
    if (!uploadedFile) return
    setAiLoading(true); setAiError('')
    const fd = new FormData()
    fd.append('file', uploadedFile)
    fd.append('level', aiLevel)
    fd.append('instructions', aiInstructions)
    fd.append('question_types', JSON.stringify(qTypes))
    const res = await fetch('/api/ai/generate-lesson-from-file', { method: 'POST', body: fd })
    const data = await res.json()
    if (res.ok) { setContent(data.content); if (!title) setTitle(uploadedFile.name.replace(/\.\w+$/, '')) }
    else setAiError(data.error ?? 'Failed')
    setAiLoading(false)
  }

  // ── AI homework questions ──
  async function generateHwQuestions() {
    if (!aiHwTopic) return
    setAiHwLoading(true)
    const res = await fetch('/api/ai/generate-exam', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: aiHwTopic, count: aiHwCount, type: 'mixed' }),
    })
    const data = await res.json()
    if (data.questions) setQuestions(prev => [...prev, ...data.questions])
    setAiHwLoading(false)
  }

  // ── AI homework from file ──
  function toggleHwType(t: string) {
    setHwTypes(prev => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  }

  async function generateHwFromFile() {
    if (hwFiles.length === 0 || hwTypes.size === 0) return
    setHwFileLoading(true); setHwFileError('')
    try {
      const fd = new FormData()
      for (const f of hwFiles) fd.append('file', f)
      fd.append('types', [...hwTypes].join(','))
      fd.append('count', String(hwFileCount))
      fd.append('instructions', hwFileInstructions)
      // Existing questions (from earlier runs/files) — server avoids duplicating them.
      fd.append('avoid', JSON.stringify(questions.map(q => q.text).slice(-100)))
      const res = await fetch('/api/ai/generate-homework-from-file', { method: 'POST', body: fd })
      const data = await res.json()
      if (res.ok && data.questions) {
        // Apply the teacher's per-type points (overrides AI defaults).
        const withPoints = (data.questions as Question[]).map(q => ({
          ...q,
          points: typePoints[q.type] ?? q.points,
        }))
        setQuestions(prev => [...prev, ...withPoints])
        if (!hwForm.title && hwFiles[0]) setHwForm(p => ({ ...p, title: `واجب: ${hwFiles[0].name.replace(/\.\w+$/, '')}` }))
        if (data.delivered < data.requested) {
          setHwFileError(`تم توليد ${data.delivered} من ${data.requested} سؤالاً فريداً — محتوى الملف لا يكفي لأكثر من ذلك بدون تكرار. يمكنك التوليد مجدداً أو الإضافة يدوياً.`)
        }
      } else {
        setHwFileError(data.error ?? 'فشل التوليد')
      }
    } catch {
      setHwFileError('خطأ في الاتصال. حاول مجدداً.')
    }
    setHwFileLoading(false)
  }

  function addManualQuestion() {
    if (!newQ.text?.trim()) return
    const q: Question = {
      id: String(Date.now()),
      text: newQ.text!,
      type: newQ.type as Question['type'],
      options: newQ.type === 'essay' ? [] : newQ.type === 'true_false' ? ['True', 'False'] : (newQ.options ?? []),
      correct_answer: newQ.type === 'essay' ? '' : (newQ.correct_answer ?? ''),
      points: newQ.points ?? 5,
    }
    setQuestions(prev => [...prev, q])
    setNewQ({ type: 'mcq', options: ['', '', '', ''], points: 5 })
    setShowAddQ(false)
  }

  async function saveHomework() {
    if (!hwForm.title.trim() || questions.length === 0) return
    setHwLoading(true)
    const groupId = lesson.groups?.id
    if (!groupId) { alert('No group linked to this lesson'); setHwLoading(false); return }
    const res = await fetch('/api/homework', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lesson_id: lesson.id,
        group_id: groupId,
        title: hwForm.title,
        questions,
        due_date: hwForm.due_date || null,
        auto_publish: autoPublishHw,
      }),
    })
    const data = await res.json()
    if (res.ok) {
      setHomework(prev => [...prev, { ...data, exam_submissions: [{ count: 0 }] }])
      setShowHwModal(false); setQuestions([]); setHwForm({ title: '', due_date: '' })
    } else alert(data.error ?? 'Failed')
    setHwLoading(false)
  }

  async function deleteHomework(id: string) {
    if (!confirm('حذف هذا الواجب؟\n\nإن كان "الحذف النهائي" مفعّلاً من إعدادات المالك فسيُمحى مع تسليماته وعلاماته نهائياً (لا رجعة). وإلا فسيُنقل إلى الأرشيف.')) return
    const res = await fetch('/api/homework', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    if (!res.ok) {
      alert((await res.json().catch(() => ({}))).error ?? 'فشل حذف الواجب')
      return
    }
    setHomework(prev => prev.filter(h => h.id !== id))
  }

  function exportGrades() {
    const groupId = lesson.groups?.id
    if (!groupId) return
    window.open(`/api/grades/export?group_id=${groupId}&format=xlsx`, '_blank')
  }

  const totalQuestions = homework.reduce((s, h) => s + (h.questions?.length ?? 0), 0)
  const totalSubmissions = homework.reduce((s, h) => s + (h.exam_submissions?.[0]?.count ?? 0), 0)

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="text-slate-400 hover:text-white transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-white">{lesson.title}</h1>
          <p className="text-slate-400 text-sm">{lesson.groups?.name ?? '—'}</p>
        </div>
        <Badge variant={published ? 'green' : 'yellow'}>
          {published ? 'منشور للطلاب' : 'مسودة — غير ظاهر للطلاب'}
        </Badge>
        <Button size="sm" variant={published ? 'secondary' : 'primary'} loading={publishing} onClick={togglePublish}>
          {published ? 'إلغاء النشر' : '📢 نشر للطلاب'}
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-800">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t ? 'border-blue-500 text-white' : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            {t === 'المحتوى' && <BookOpen className="w-4 h-4 inline ml-1.5" />}
            {t === 'الواجب' && <ClipboardList className="w-4 h-4 inline ml-1.5" />}
            {t === 'التسليمات' && <Users className="w-4 h-4 inline ml-1.5" />}
            {t}
            {t === 'الواجب' && homework.length > 0 && (
              <span className="mr-1.5 bg-blue-600 text-white text-xs rounded-full px-1.5">{homework.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Tab: Content ── */}
      {tab === 'المحتوى' && (
        <div className="space-y-4">
          {/* File upload toggle */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setFileMode(!fileMode)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                fileMode ? 'border-violet-500 bg-violet-500/10 text-violet-300' : 'border-slate-700 text-slate-400 hover:border-slate-600 hover:text-white'
              }`}
            >
              <Upload className="w-4 h-4" />
              توليد من ملف
            </button>
            <span className="text-slate-600 text-sm">أو اكتب المحتوى يدوياً أدناه</span>
          </div>

          {/* AI from file panel */}
          {fileMode && (
            <div className="bg-violet-500/5 border border-violet-500/20 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="w-4 h-4 text-violet-400" />
                <span className="text-violet-300 text-sm font-medium">توليد محتوى الدرس من ملف</span>
              </div>

              {/* File picker */}
              <div
                onClick={() => fileRef.current?.click()}
                className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
                  uploadedFile ? 'border-violet-500 bg-violet-500/10' : 'border-slate-700 hover:border-slate-600'
                }`}
              >
                {uploadedFile ? (
                  <div className="flex items-center justify-center gap-2">
                    <FileText className="w-5 h-5 text-violet-400" />
                    <span className="text-white text-sm">{uploadedFile.name}</span>
                    <span className="text-slate-500 text-xs">({(uploadedFile.size / 1024 / 1024).toFixed(1)} MB)</span>
                  </div>
                ) : (
                  <p className="text-slate-400 text-sm">اضغط لاختيار ملف — PDF / PPTX / DOCX / JPG / PNG (حتى 20 MB)</p>
                )}
              </div>
              <input ref={fileRef} type="file" accept=".pdf,.pptx,.docx,.jpg,.jpeg,.png,.webp" className="hidden"
                onChange={e => setUploadedFile(e.target.files?.[0] ?? null)} />

              <div className="flex gap-2">
                <select value={aiLevel} onChange={e => setAiLevel(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500">
                  <option value="high_school">ثانوي</option>
                  <option value="undergraduate">جامعي</option>
                  <option value="graduate">دراسات عليا</option>
                </select>
                <Button onClick={generateFromFile} loading={aiLoading} disabled={!uploadedFile} variant="secondary" size="sm">
                  <Sparkles className="w-4 h-4" /> توليد
                </Button>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-500">طبيعة أسئلة الكويز والاختبار — فعّل ما تريد (واحد أو أكثر)</label>
                <div className="flex flex-wrap gap-2">
                  {QTYPE_OPTIONS.map(opt => {
                    const on = qTypes.includes(opt.key)
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => toggleQType(opt.key)}
                        className={`px-3.5 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                          on
                            ? 'border-violet-500 bg-violet-500/15 text-violet-300'
                            : 'border-slate-700 text-slate-500 hover:border-slate-500 hover:text-slate-300'
                        }`}
                      >
                        {on ? '✓ ' : ''}{opt.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-500">تعليمات إضافية (اختياري) — يمكنك تحديد التبويبات التي تريدها بنفسك</label>
                <textarea value={aiInstructions} onChange={e => setAiInstructions(e.target.value)} rows={2}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm resize-none focus:outline-none focus:ring-1 focus:ring-violet-500"
                  placeholder='مثال: "قسّم الدرس إلى: محادثة، استماع وفهم، قواعد، كلمات جديدة" — أو أي توجيه آخر. اتركه فارغاً وسيختار الذكاء الاصطناعي التبويبات المناسبة تلقائياً.' />
              </div>

              <AiProgress active={aiLoading} />

              {aiError && <p className="text-red-400 text-sm">{aiError}</p>}
            </div>
          )}

          {/* Title */}
          <Input label="عنوان الدرس" value={title} onChange={e => setTitle(e.target.value)} />

          {/* Content editor */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-slate-300">المحتوى (Markdown)</label>
              <button
                onClick={() => setPreviewMode(p => !p)}
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 text-xs transition-colors"
              >
                {previewMode ? <><EyeOff className="w-3.5 h-3.5" /> تحرير</> : <><Eye className="w-3.5 h-3.5" /> معاينة</>}
              </button>
            </div>
            {previewMode ? (
              <div className="min-h-[300px] px-4 py-3 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm prose prose-invert max-w-none">
                {content.trim() ? <LessonTabs content={content} /> : <p className="text-slate-500 italic">لا يوجد محتوى للمعاينة</p>}
              </div>
            ) : (
              <textarea
                value={content}
                onChange={e => setContent(e.target.value)}
                rows={18}
                className="w-full px-4 py-3 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm resize-y focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                placeholder="اكتب محتوى الدرس هنا أو ولّده من ملف..."
                dir="auto"
              />
            )}
          </div>

          <div className="flex justify-end">
            <Button onClick={saveContent} loading={saving}>
              {saved ? <><Check className="w-4 h-4" /> تم الحفظ</> : 'حفظ التغييرات'}
            </Button>
          </div>
        </div>
      )}

      {/* ── Tab: Homework ── */}
      {tab === 'الواجب' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white font-medium">الواجبات اليومية</p>
              <p className="text-slate-500 text-sm">{totalQuestions} سؤال · {totalSubmissions} تسليم</p>
            </div>
            <Button onClick={() => setShowHwModal(true)}>
              <Plus className="w-4 h-4" /> إضافة واجب
            </Button>
          </div>

          {homework.length === 0 ? (
            <div className="text-center py-16 bg-slate-900 border border-slate-800 rounded-xl">
              <ClipboardList className="w-10 h-10 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400">لا يوجد واجبات لهذا الدرس بعد.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {homework.map(hw => (
                <div key={hw.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-white font-medium">{hw.title}</p>
                      <Badge variant={hw.is_published ? 'green' : 'yellow'}>
                        {hw.is_published ? 'منشور' : 'مسودة'}
                      </Badge>
                    </div>
                    <p className="text-slate-500 text-sm">
                      {hw.questions?.length ?? 0} سؤال ·{' '}
                      {hw.exam_submissions?.[0]?.count ?? 0} تسليم
                      {hw.ends_at && ` · موعد التسليم: ${new Date(hw.ends_at).toLocaleDateString('ar')}`}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => deleteHomework(hw.id)}
                      className="hover:text-red-400 hover:bg-red-500/10">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Export */}
          {homework.length > 0 && (
            <div className="pt-2 border-t border-slate-800">
              <Button variant="secondary" onClick={exportGrades}>
                <Download className="w-4 h-4" /> تصدير الدرجات (Excel/CSV)
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Submissions ── */}
      {tab === 'التسليمات' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-white font-medium">التسليمات والدرجات</p>
            <Button variant="secondary" onClick={exportGrades}>
              <Download className="w-4 h-4" /> تصدير Excel
            </Button>
          </div>
          <SubmissionsTab lessonId={lesson.id} />
        </div>
      )}

      {/* ── Homework Modal ── */}
      <Modal open={showHwModal} onClose={() => { setShowHwModal(false); setQuestions([]) }} title="إضافة واجب يومي" size="xl">
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">

          {/* AI generator */}
          <div className="bg-violet-500/10 border border-violet-500/20 rounded-xl p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-violet-400" />
              <span className="text-violet-300 text-sm font-medium">توليد أسئلة بالذكاء الاصطناعي</span>
            </div>
            <div className="flex gap-2">
              <input value={aiHwTopic} onChange={e => setAiHwTopic(e.target.value)}
                placeholder="موضوع الأسئلة (مثل: مقدمة أمن المعلومات)"
                className="flex-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500" />
              <input type="number" value={aiHwCount} onChange={e => setAiHwCount(Number(e.target.value))} min={1} max={20}
                className="w-16 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm text-center focus:outline-none focus:ring-2 focus:ring-violet-500" />
              <Button onClick={generateHwQuestions} loading={aiHwLoading} variant="secondary" size="sm">توليد</Button>
            </div>
          </div>

          {/* AI from file */}
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Upload className="w-4 h-4 text-blue-400" />
              <span className="text-blue-300 text-sm font-medium">توليد واجب من ملف — الأسئلة من محتوى الملف فقط</span>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => hwFileRef.current?.click()}
                  className="px-3 py-2 rounded-lg border border-blue-500 bg-blue-500/10 text-blue-300 text-sm hover:bg-blue-500/20 transition-colors">
                  <Plus className="w-3.5 h-3.5 inline -mt-0.5" /> {hwFiles.length ? 'إضافة ملفات أخرى' : 'اختر ملفاً أو أكثر (PDF / DOCX / PPTX / صورة)'}
                </button>
                {/* Appends to the existing selection (dedup by name+size) so the
                    teacher can pick 10 now and more later without losing anything. */}
                <input ref={hwFileRef} type="file" multiple accept=".pptx,.docx,.pdf,.jpg,.jpeg,.png,.webp" className="hidden"
                  onChange={e => {
                    const picked = Array.from(e.target.files ?? [])
                    setHwFiles(prev => {
                      const seen = new Set(prev.map(f => f.name + f.size))
                      return [...prev, ...picked.filter(f => !seen.has(f.name + f.size))].slice(0, 10)
                    })
                    setHwFileError('')
                    e.target.value = ''
                  }} />
                <input type="number" value={hwFileCount} onChange={e => setHwFileCount(Number(e.target.value))} min={1} max={120}
                  title="عدد الأسئلة"
                  className="w-16 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <span className="text-slate-500 text-xs">سؤال</span>
              </div>
              {hwFiles.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {hwFiles.map((f, i) => (
                    <span key={f.name + f.size} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-xs">
                      📄 {f.name}
                      <button type="button" title="إزالة هذا الملف"
                        onClick={() => setHwFiles(prev => prev.filter((_, j) => j !== i))}
                        className="text-slate-500 hover:text-red-400"><X className="w-3 h-3" /></button>
                    </span>
                  ))}
                  <span className="text-slate-600 text-xs self-center">{hwFiles.length}/10</span>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {([['mcq', 'اختيار من متعدد'], ['true_false', 'صح / خطأ'], ['essay', 'مقالي']] as const).map(([t, label]) => (
                  <div key={t} className="flex items-center gap-1.5">
                    <button type="button" onClick={() => toggleHwType(t)}
                      className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                        hwTypes.has(t) ? 'border-blue-500 bg-blue-500/15 text-blue-300' : 'border-slate-700 text-slate-400 hover:border-slate-500'
                      }`}>
                      {hwTypes.has(t) ? '✓ ' : ''}{label}
                    </button>
                    {hwTypes.has(t) && (
                      <>
                        <input type="number" min={1} max={100} value={typePoints[t]}
                          title={`علامة كل سؤال ${label}`}
                          onChange={e => setTypePoints(p => ({ ...p, [t]: Math.max(1, Number(e.target.value)) }))}
                          className="w-14 px-2 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm text-center focus:outline-none focus:ring-1 focus:ring-blue-500" />
                        <span className="text-slate-500 text-xs">علامة</span>
                      </>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-slate-500 text-xs">حدد علامة كل سؤال حسب نوعه — وبعد التوليد يمكنك تعديل علامة أي سؤال منفرداً.</p>
            </div>

            <textarea value={hwFileInstructions} onChange={e => setHwFileInstructions(e.target.value)} rows={2}
              className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder='تعليمات إضافية للذكاء الاصطناعي (اختياري) — مثال: "ركّز على القسم الثاني من الملف واجعل الأسئلة قصيرة"' />

            <AiProgress active={hwFileLoading} />
            {hwFileError && <p className="text-red-400 text-sm">{hwFileError}</p>}

            <Button onClick={generateHwFromFile} loading={hwFileLoading} disabled={hwFiles.length === 0 || hwTypes.size === 0} variant="secondary" size="sm">
              <Sparkles className="w-4 h-4" /> توليد الأسئلة من الملف
            </Button>
          </div>

          {/* Homework title + due date */}
          <div className="grid grid-cols-2 gap-3">
            <Input label="عنوان الواجب" value={hwForm.title}
              onChange={e => setHwForm(p => ({ ...p, title: e.target.value }))}
              placeholder="مثال: واجب الوحدة الأولى" required />
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-300">موعد التسليم (اختياري)</label>
              <input type="datetime-local" value={hwForm.due_date}
                onChange={e => setHwForm(p => ({ ...p, due_date: e.target.value }))}
                className="w-full px-4 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          {/* Auto-publish results (auto-gradable questions only) */}
          {(() => {
            const hasEssay = questions.some(q => q.type === 'essay')
            return (
              <label className={`flex items-start gap-3 rounded-lg border px-4 py-3 cursor-pointer ${hasEssay ? 'border-slate-800 opacity-60 cursor-not-allowed' : 'border-slate-700 hover:border-slate-500'}`}>
                <input
                  type="checkbox"
                  checked={autoPublishHw && !hasEssay}
                  disabled={hasEssay}
                  onChange={e => setAutoPublishHw(e.target.checked)}
                  className="mt-0.5 accent-blue-500"
                />
                <span className="text-sm">
                  <span className="text-slate-200 font-medium">نشر النتائج تلقائياً فور التسليم</span>
                  <span className="block text-slate-500 text-xs mt-0.5">
                    {hasEssay
                      ? 'غير متاح — الواجب يحتوي أسئلة مقالية تتطلب تصحيحك اليدوي ثم نشر النتائج من تبويب التسليمات.'
                      : 'أسئلة الاختيار والصح/خطأ تُصحح آلياً — يرى الطالب علامته مباشرة بعد التسليم.'}
                  </span>
                </span>
              </label>
            )
          })()}

          {/* Questions list */}
          {questions.length > 0 && (
            <div className="space-y-2">
              <p className="text-slate-300 text-sm font-medium">
                {questions.length} سؤال — العلامة الكاملة: <span className="text-white font-bold">{questions.reduce((s, q) => s + (q.points || 0), 0)}</span>
              </p>
              {questions.map((q, i) => (
                <div key={q.id} className="flex items-start gap-3 bg-slate-800 rounded-lg p-3">
                  <span className="text-slate-500 text-xs font-mono mt-0.5">{i + 1}.</span>
                  <div className="flex-1">
                    <p className="text-slate-300 text-sm">{q.text}</p>
                    {q.correct_answer && <p className="text-green-500 text-xs mt-0.5">✓ {q.correct_answer}</p>}
                  </div>
                  <Badge variant={q.type === 'mcq' ? 'blue' : q.type === 'essay' ? 'yellow' : 'gray'}>
                    {q.type === 'mcq' ? 'اختيار' : q.type === 'essay' ? 'مقالي' : 'صح/خطأ'}
                  </Badge>
                  <span className="flex items-center gap-1 shrink-0">
                    <input type="number" min={1} max={100} value={q.points}
                      title="علامة هذا السؤال"
                      onChange={e => {
                        const v = Math.max(1, Number(e.target.value))
                        setQuestions(p => p.map(x => x.id === q.id ? { ...x, points: v } : x))
                      }}
                      className="w-14 px-1.5 py-1 rounded bg-slate-900 border border-slate-700 text-white text-xs text-center focus:outline-none focus:ring-1 focus:ring-blue-500" />
                    <span className="text-slate-500 text-xs">د</span>
                  </span>
                  <button onClick={() => setQuestions(p => p.filter(x => x.id !== q.id))}
                    className="text-slate-500 hover:text-red-400"><X className="w-3.5 h-3.5" /></button>
                </div>
              ))}
            </div>
          )}

          {/* Add manual question */}
          {showAddQ ? (
            <div className="bg-slate-800 rounded-xl p-4 space-y-3 border border-slate-700">
              <div className="flex items-center justify-between">
                <p className="text-white text-sm font-medium">سؤال جديد</p>
                <button onClick={() => setShowAddQ(false)} className="text-slate-500 hover:text-white"><X className="w-4 h-4" /></button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select value={newQ.type} onChange={e => setNewQ(p => ({ ...p, type: e.target.value as Question['type'] }))}
                  className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-white text-sm focus:outline-none focus:ring-1 focus:ring-blue-500">
                  <option value="mcq">اختيار من متعدد</option>
                  <option value="true_false">صح / خطأ</option>
                  <option value="essay">مقالي</option>
                </select>
                <input type="number" placeholder="الدرجة" value={newQ.points ?? 5}
                  onChange={e => setNewQ(p => ({ ...p, points: Number(e.target.value) }))}
                  className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-white text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
              <textarea value={newQ.text ?? ''} onChange={e => setNewQ(p => ({ ...p, text: e.target.value }))}
                rows={2} placeholder="نص السؤال"
                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-white text-sm resize-none focus:outline-none focus:ring-1 focus:ring-blue-500" />
              {newQ.type === 'mcq' && (
                <div className="grid grid-cols-2 gap-2">
                  {(newQ.options ?? ['', '', '', '']).map((opt, i) => (
                    <input key={i} value={opt} placeholder={`الخيار ${i + 1}`}
                      onChange={e => setNewQ(p => ({ ...p, options: (p.options ?? []).map((o, j) => j === i ? e.target.value : o) }))}
                      className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-white text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
                  ))}
                  <input value={newQ.correct_answer ?? ''} placeholder="الإجابة الصحيحة"
                    onChange={e => setNewQ(p => ({ ...p, correct_answer: e.target.value }))}
                    className="col-span-2 px-3 py-2 rounded-lg bg-slate-900 border border-green-600/50 text-white text-sm focus:outline-none focus:ring-1 focus:ring-green-500" />
                </div>
              )}
              {newQ.type === 'true_false' && (
                <select value={newQ.correct_answer ?? 'True'}
                  onChange={e => setNewQ(p => ({ ...p, correct_answer: e.target.value }))}
                  className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-white text-sm focus:outline-none focus:ring-1 focus:ring-blue-500">
                  <option value="True">صح (True)</option>
                  <option value="False">خطأ (False)</option>
                </select>
              )}
              {newQ.type === 'essay' && (
                <p className="text-slate-500 text-xs">الأسئلة المقالية تُصحح يدوياً من قبل المعلم.</p>
              )}
              <Button onClick={addManualQuestion} size="sm">إضافة السؤال</Button>
            </div>
          ) : (
            <button onClick={() => setShowAddQ(true)}
              className="w-full py-2.5 rounded-lg border-2 border-dashed border-slate-700 text-slate-400 hover:border-slate-500 hover:text-white text-sm transition-colors flex items-center justify-center gap-2">
              <Plus className="w-4 h-4" /> إضافة سؤال يدوياً
            </button>
          )}

          <div className="flex gap-3 pt-2 sticky bottom-0 bg-slate-900 pb-1">
            <Button variant="secondary" onClick={() => { setShowHwModal(false); setQuestions([]) }} className="flex-1">إلغاء</Button>
            <Button onClick={saveHomework} loading={hwLoading} disabled={!hwForm.title || questions.length === 0} className="flex-1">
              حفظ الواجب ({questions.length} سؤال)
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
