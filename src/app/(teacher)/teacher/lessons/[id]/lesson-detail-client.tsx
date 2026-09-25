'use client'
import { confirmDialog } from '@/lib/confirm-dialog'

import { useState, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/components/ui/toast'
import {
  ArrowLeft, BookOpen, ClipboardList, Users, Sparkles, Upload,
  FileText, Plus, Trash2, Download, Check, X, Eye, EyeOff
} from 'lucide-react'
import { LessonTabs } from '@/components/shared/lesson-tabs'
import { AiProgress } from '@/components/shared/ai-progress'
import { extractFilesText } from '@/lib/ai/extract-client'
import { SubmissionsTab } from './submissions-tab'
import { Modal } from '@/components/ui/modal'
import { useTranslations } from 'next-intl'

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

type Tab = 'content' | 'homework' | 'submissions'

export function LessonDetailClient({ lesson, initialHomework }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const t = useTranslations('teacher')
  const tAi = useTranslations('common.ai')
  const [tab, setTab] = useState<Tab>('content')

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
      toast.error((await res.json().catch(() => ({}))).error ?? t('lessonDetail.publishFailed'))
    }
    setPublishing(false)
  }

  const [previewMode, setPreviewMode] = useState(() => !!(lesson.content ?? '').trim())

  const [fileMode, setFileMode] = useState(() => searchParams.get('generate') === 'file')
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [aiLevel, setAiLevel] = useState('undergraduate')
  const [aiInstructions, setAiInstructions] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const [homework, setHomework] = useState(initialHomework)
  const [showHwModal, setShowHwModal] = useState(false)
  const [hwForm, setHwForm] = useState({ title: '', due_date: '' })
  const [autoPublishHw, setAutoPublishHw] = useState(true)
  const [questions, setQuestions] = useState<Question[]>([])
  const [hwLoading, setHwLoading] = useState(false)
  const [aiHwTopic, setAiHwTopic] = useState('')
  const [aiHwCount, setAiHwCount] = useState(5)
  const [aiHwLoading, setAiHwLoading] = useState(false)

  const [hwFiles, setHwFiles] = useState<File[]>([])
  const [hwTypes, setHwTypes] = useState<Set<string>>(new Set(['mcq', 'true_false']))
  const [typePoints, setTypePoints] = useState<Record<string, number>>({ mcq: 1, true_false: 1, essay: 5 })
  const [hwFileCount, setHwFileCount] = useState(10)
  const [hwFileInstructions, setHwFileInstructions] = useState('')
  const [hwFileLoading, setHwFileLoading] = useState(false)
  const [hwFileError, setHwFileError] = useState('')
  const hwFileRef = useRef<HTMLInputElement>(null)

  const [newQ, setNewQ] = useState<Partial<Question>>({ type: 'mcq', options: ['', '', '', ''], points: 5 })
  const [showAddQ, setShowAddQ] = useState(false)

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

  const QTYPE_OPTIONS = [
    { key: 'true_false', label: t('courses.builder.trueFalse') },
    { key: 'mcq', label: t('courses.builder.mcq') },
    { key: 'essay', label: t('courses.builder.essay') },
  ] as const
  const [qTypes, setQTypes] = useState<string[]>(['true_false', 'mcq'])

  function toggleQType(key: string) {
    setQTypes(prev => prev.includes(key)
      ? (prev.length > 1 ? prev.filter(k => k !== key) : prev)
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

  function toggleHwType(qt: string) {
    setHwTypes(prev => {
      const next = new Set(prev)
      if (next.has(qt)) next.delete(qt)
      else next.add(qt)
      return next
    })
  }

  async function generateHwFromFile() {
    if (hwFiles.length === 0 || hwTypes.size === 0) return
    setHwFileLoading(true); setHwFileError('')
    try {
      const extracted = await extractFilesText(hwFiles, tAi)
      if ('error' in extracted) { setHwFileError(extracted.error); setHwFileLoading(false); return }
      const fd = new FormData()
      fd.append('sourceText', extracted.combined)
      fd.append('types', [...hwTypes].join(','))
      fd.append('count', String(hwFileCount))
      fd.append('instructions', hwFileInstructions)
      fd.append('avoid', JSON.stringify(questions.map(q => q.text).slice(-100)))
      const res = await fetch('/api/ai/generate-homework-from-file', { method: 'POST', body: fd })
      const data = await res.json()
      if (res.ok && data.questions) {
        const withPoints = (data.questions as Question[]).map(q => ({
          ...q,
          points: typePoints[q.type] ?? q.points,
        }))
        setQuestions(prev => [...prev, ...withPoints])
        if (!hwForm.title && hwFiles[0]) setHwForm(p => ({ ...p, title: t('lessonDetail.hwNamePrefix', { name: hwFiles[0].name.replace(/\.\w+$/, '') }) }))
        if (data.delivered < data.requested) {
          setHwFileError(t('lessonDetail.partialGeneration', { delivered: data.delivered, requested: data.requested }))
        }
      } else {
        setHwFileError(data.error ?? t('lessonDetail.generateFailed'))
      }
    } catch {
      setHwFileError(t('lessonDetail.connectionError'))
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
    if (!groupId) { toast.warning(t('lessonDetail.noGroup')); setHwLoading(false); return }
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
    } else toast.error(data.error ?? 'Failed')
    setHwLoading(false)
  }

  async function deleteHomework(id: string) {
    if (!(await confirmDialog(t('lessonDetail.hwDeleteConfirm')))) return
    const res = await fetch('/api/homework', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    if (!res.ok) {
      toast.error((await res.json().catch(() => ({}))).error ?? t('lessonDetail.hwDeleteFailed'))
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
  const markUnit = t('courses.builder.markUnit')

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'content', label: t('lessonDetail.tabs.content'), icon: <BookOpen className="w-4 h-4 inline ms-1.5" /> },
    { id: 'homework', label: t('lessonDetail.tabs.homework'), icon: <ClipboardList className="w-4 h-4 inline ms-1.5" /> },
    { id: 'submissions', label: t('lessonDetail.tabs.submissions'), icon: <Users className="w-4 h-4 inline ms-1.5" /> },
  ]

  const qtypeLabels: Record<string, string> = {
    mcq: t('courses.builder.mcq'),
    true_false: t('courses.builder.trueFalse'),
    essay: t('courses.builder.essay'),
  }

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
          {published ? t('lessonDetail.publishedBadge') : t('lessonDetail.draftBadge')}
        </Badge>
        <Button size="sm" variant={published ? 'secondary' : 'primary'} loading={publishing} onClick={togglePublish}>
          {published ? t('lessonDetail.unpublish') : t('lessonDetail.publish')}
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-800">
        {tabs.map(({ id, label, icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === id ? 'border-blue-500 text-white' : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            {icon}
            {label}
            {id === 'homework' && homework.length > 0 && (
              <span className="me-1.5 bg-blue-600 text-white text-xs rounded-full px-1.5">{homework.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Tab: Content ── */}
      {tab === 'content' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setFileMode(!fileMode)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                fileMode ? 'border-violet-500 bg-violet-500/10 text-violet-300' : 'border-slate-700 text-slate-400 hover:border-slate-600 hover:text-white'
              }`}
            >
              <Upload className="w-4 h-4" />
              {t('lessonDetail.fileGenToggle')}
            </button>
            <span className="text-slate-600 text-sm">{t('lessonDetail.fileGenOr')}</span>
          </div>

          {fileMode && (
            <div className="bg-violet-500/5 border border-violet-500/20 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="w-4 h-4 text-violet-400" />
                <span className="text-violet-300 text-sm font-medium">{t('lessonDetail.fileGenHeader')}</span>
              </div>

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
                    <span className="text-slate-500 text-xs">{t('lessonDetail.fileSize', { size: (uploadedFile.size / 1024 / 1024).toFixed(1) })}</span>
                  </div>
                ) : (
                  <p className="text-slate-400 text-sm">{t('lessonDetail.filePicker')}</p>
                )}
              </div>
              <input ref={fileRef} type="file" accept=".pdf,.pptx,.docx,.jpg,.jpeg,.png,.webp" className="hidden"
                onChange={e => setUploadedFile(e.target.files?.[0] ?? null)} />

              <div className="flex gap-2">
                <select value={aiLevel} onChange={e => setAiLevel(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500">
                  <option value="high_school">{t('lessons.modal.levelHighSchool')}</option>
                  <option value="undergraduate">{t('lessons.modal.levelUndergrad')}</option>
                  <option value="graduate">{t('lessons.modal.levelGrad')}</option>
                </select>
                <Button onClick={generateFromFile} loading={aiLoading} disabled={!uploadedFile} variant="secondary" size="sm">
                  <Sparkles className="w-4 h-4" /> {t('courses.builder.hwGenerateBtn')}
                </Button>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-500">{t('courses.builder.hwQuestionsLabel')}</label>
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
                <label className="text-xs text-slate-500">{t('lessonDetail.instructionsLabel')}</label>
                <textarea value={aiInstructions} onChange={e => setAiInstructions(e.target.value)} rows={2}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm resize-none focus:outline-none focus:ring-1 focus:ring-violet-500"
                  placeholder={t('lessonDetail.instructionsPlaceholder')} />
              </div>

              <AiProgress active={aiLoading} />

              {aiError && <p className="text-red-400 text-sm">{aiError}</p>}
            </div>
          )}

          <Input label={t('lessonDetail.titleLabel')} value={title} onChange={e => setTitle(e.target.value)} />

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-slate-300">{t('lessonDetail.contentLabel')}</label>
              <button
                onClick={() => setPreviewMode(p => !p)}
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 text-xs transition-colors"
              >
                {previewMode ? <><EyeOff className="w-3.5 h-3.5" /> {t('lessonDetail.editMode')}</> : <><Eye className="w-3.5 h-3.5" /> {t('lessonDetail.previewMode')}</>}
              </button>
            </div>
            {previewMode ? (
              <div className="min-h-[300px] px-4 py-3 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm prose prose-invert max-w-none">
                {content.trim() ? <LessonTabs content={content} /> : <p className="text-slate-500 italic">{t('lessonDetail.noPreview')}</p>}
              </div>
            ) : (
              <textarea
                value={content}
                onChange={e => setContent(e.target.value)}
                rows={18}
                className="w-full px-4 py-3 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm resize-y focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                placeholder={t('lessonDetail.contentPlaceholder')}
                dir="auto"
              />
            )}
          </div>

          <div className="flex justify-end">
            <Button onClick={saveContent} loading={saving}>
              {saved ? <><Check className="w-4 h-4" /> {t('lessonDetail.saved')}</> : t('lessonDetail.saveChanges')}
            </Button>
          </div>
        </div>
      )}

      {/* ── Tab: Homework ── */}
      {tab === 'homework' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white font-medium">{t('lessonDetail.homeworkSectionTitle')}</p>
              <p className="text-slate-500 text-sm">{t('lessonDetail.homeworkSubtitle', { questions: totalQuestions, submissions: totalSubmissions })}</p>
            </div>
            <Button onClick={() => setShowHwModal(true)}>
              <Plus className="w-4 h-4" /> {t('lessonDetail.addHomework')}
            </Button>
          </div>

          {homework.length === 0 ? (
            <div className="text-center py-16 bg-slate-900 border border-slate-800 rounded-xl">
              <ClipboardList className="w-10 h-10 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400">{t('lessonDetail.noHomework')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {homework.map(hw => (
                <div key={hw.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-white font-medium">{hw.title}</p>
                      <Badge variant={hw.is_published ? 'green' : 'yellow'}>
                        {hw.is_published ? t('lessons.published') : t('lessons.draft')}
                      </Badge>
                    </div>
                    <p className="text-slate-500 text-sm">
                      {t('lessonDetail.hwStats', { count: hw.questions?.length ?? 0, submissions: hw.exam_submissions?.[0]?.count ?? 0 })}
                      {hw.ends_at && ` · ${t('lessonDetail.dueDateDisplay', { date: new Date(hw.ends_at).toLocaleDateString() })}`}
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

          {homework.length > 0 && (
            <div className="pt-2 border-t border-slate-800">
              <Button variant="secondary" onClick={exportGrades}>
                <Download className="w-4 h-4" /> {t('lessonDetail.exportGrades')}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Submissions ── */}
      {tab === 'submissions' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-white font-medium">{t('lessonDetail.submissionsTitle')}</p>
            <Button variant="secondary" onClick={exportGrades}>
              <Download className="w-4 h-4" /> {t('lessonDetail.exportExcel')}
            </Button>
          </div>
          <SubmissionsTab lessonId={lesson.id} />
        </div>
      )}

      {/* ── Homework Modal ── */}
      <Modal open={showHwModal} onClose={() => { setShowHwModal(false); setQuestions([]) }} title={t('lessonDetail.hwModalTitle')} size="xl">
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pe-1">

          {/* AI generator */}
          <div className="bg-violet-500/10 border border-violet-500/20 rounded-xl p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-violet-400" />
              <span className="text-violet-300 text-sm font-medium">{t('lessonDetail.aiHwGenerator')}</span>
            </div>
            <div className="flex gap-2">
              <input value={aiHwTopic} onChange={e => setAiHwTopic(e.target.value)}
                placeholder={t('courses.builder.hwAiTopic')}
                className="flex-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500" />
              <input type="number" value={aiHwCount} onChange={e => setAiHwCount(Number(e.target.value))} min={1} max={20}
                className="w-16 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm text-center focus:outline-none focus:ring-2 focus:ring-violet-500" />
              <Button onClick={generateHwQuestions} loading={aiHwLoading} variant="secondary" size="sm">{t('courses.builder.hwGenerateBtn')}</Button>
            </div>
          </div>

          {/* AI from file */}
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Upload className="w-4 h-4 text-blue-400" />
              <span className="text-blue-300 text-sm font-medium">{t('lessonDetail.hwFileGenerator')}</span>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => hwFileRef.current?.click()}
                  className="px-3 py-2 rounded-lg border border-blue-500 bg-blue-500/10 text-blue-300 text-sm hover:bg-blue-500/20 transition-colors">
                  <Plus className="w-3.5 h-3.5 inline -mt-0.5" /> {hwFiles.length ? t('exams.modal.addMoreFiles') : t('exams.modal.addFiles')}
                </button>
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
                  title={t('exams.modal.questionCount')}
                  className="w-16 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <span className="text-slate-500 text-xs">{t('exams.modal.questionUnit')}</span>
              </div>
              {hwFiles.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {hwFiles.map((f, i) => (
                    <span key={f.name + f.size} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-xs">
                      📄 {f.name}
                      <button type="button" title={t('exams.modal.removeFile')}
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
                {(['mcq', 'true_false', 'essay'] as const).map(qt => (
                  <div key={qt} className="flex items-center gap-1.5">
                    <button type="button" onClick={() => toggleHwType(qt)}
                      className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                        hwTypes.has(qt) ? 'border-blue-500 bg-blue-500/15 text-blue-300' : 'border-slate-700 text-slate-400 hover:border-slate-500'
                      }`}>
                      {hwTypes.has(qt) ? '✓ ' : ''}{qtypeLabels[qt]}
                    </button>
                    {hwTypes.has(qt) && (
                      <>
                        <input type="number" min={1} max={100} value={typePoints[qt]}
                          title={`${t('courses.builder.questionGrade')} ${qtypeLabels[qt]}`}
                          onChange={e => setTypePoints(p => ({ ...p, [qt]: Math.max(1, Number(e.target.value)) }))}
                          className="w-14 px-2 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm text-center focus:outline-none focus:ring-1 focus:ring-blue-500" />
                        <span className="text-slate-500 text-xs">{markUnit}</span>
                      </>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-slate-500 text-xs">{t('exams.modal.qtypeHint')}</p>
            </div>

            <textarea value={hwFileInstructions} onChange={e => setHwFileInstructions(e.target.value)} rows={2}
              className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder={t('exams.modal.instructionsPlaceholder')} />

            <AiProgress active={hwFileLoading} />
            {hwFileError && <p className="text-red-400 text-sm">{hwFileError}</p>}

            <Button onClick={generateHwFromFile} loading={hwFileLoading} disabled={hwFiles.length === 0 || hwTypes.size === 0} variant="secondary" size="sm">
              <Sparkles className="w-4 h-4" /> {t('exams.modal.generateFromFile')}
            </Button>
          </div>

          {/* Homework title + due date */}
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('lessonDetail.hwTitleLabel')} value={hwForm.title}
              onChange={e => setHwForm(p => ({ ...p, title: e.target.value }))}
              placeholder={t('lessonDetail.hwTitlePlaceholder')} required />
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-300">{t('courses.builder.dueDate')}</label>
              <input type="datetime-local" value={hwForm.due_date}
                onChange={e => setHwForm(p => ({ ...p, due_date: e.target.value }))}
                className="w-full px-4 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

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
                  <span className="text-slate-200 font-medium">{t('lessonDetail.autoPublishTitle')}</span>
                  <span className="block text-slate-500 text-xs mt-0.5">
                    {hasEssay ? t('lessonDetail.autoPublishDisabled') : t('lessonDetail.autoPublishSubtitle')}
                  </span>
                </span>
              </label>
            )
          })()}

          {questions.length > 0 && (
            <div className="space-y-2">
              <p className="text-slate-300 text-sm font-medium">
                {t('lessonDetail.questionsSummary', { count: questions.length })} <span className="text-white font-bold">{questions.reduce((s, q) => s + (q.points || 0), 0)}</span>
              </p>
              {questions.map((q, i) => (
                <div key={q.id} className="flex items-start gap-3 bg-slate-800 rounded-lg p-3">
                  <span className="text-slate-500 text-xs font-mono mt-0.5">{i + 1}.</span>
                  <div className="flex-1">
                    <p className="text-slate-300 text-sm">{q.text}</p>
                    {q.correct_answer && <p className="text-green-500 text-xs mt-0.5">✓ {q.correct_answer}</p>}
                  </div>
                  <Badge variant={q.type === 'mcq' ? 'blue' : q.type === 'essay' ? 'yellow' : 'gray'}>
                    {qtypeLabels[q.type]}
                  </Badge>
                  <span className="flex items-center gap-1 shrink-0">
                    <input type="number" min={1} max={100} value={q.points}
                      title={t('courses.builder.questionGrade')}
                      onChange={e => {
                        const v = Math.max(1, Number(e.target.value))
                        setQuestions(p => p.map(x => x.id === q.id ? { ...x, points: v } : x))
                      }}
                      className="w-14 px-1.5 py-1 rounded bg-slate-900 border border-slate-700 text-white text-xs text-center focus:outline-none focus:ring-1 focus:ring-blue-500" />
                    <span className="text-slate-500 text-xs">{markUnit}</span>
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
                <p className="text-white text-sm font-medium">{t('courses.builder.newQuestion')}</p>
                <button onClick={() => setShowAddQ(false)} className="text-slate-500 hover:text-white"><X className="w-4 h-4" /></button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select value={newQ.type} onChange={e => setNewQ(p => ({ ...p, type: e.target.value as Question['type'] }))}
                  className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-white text-sm focus:outline-none focus:ring-1 focus:ring-blue-500">
                  <option value="mcq">{t('courses.builder.mcq')}</option>
                  <option value="true_false">{t('courses.builder.trueFalse')}</option>
                  <option value="essay">{t('courses.builder.essay')}</option>
                </select>
                <input type="number" placeholder={t('courses.builder.questionGradeColon')} value={newQ.points ?? 5}
                  onChange={e => setNewQ(p => ({ ...p, points: Number(e.target.value) }))}
                  className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-white text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
              <textarea value={newQ.text ?? ''} onChange={e => setNewQ(p => ({ ...p, text: e.target.value }))}
                rows={2} placeholder={t('courses.builder.questionText')}
                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-white text-sm resize-none focus:outline-none focus:ring-1 focus:ring-blue-500" />
              {newQ.type === 'mcq' && (
                <div className="grid grid-cols-2 gap-2">
                  {(newQ.options ?? ['', '', '', '']).map((opt, i) => (
                    <input key={i} value={opt} placeholder={t('courses.builder.option', { n: i + 1 })}
                      onChange={e => setNewQ(p => ({ ...p, options: (p.options ?? []).map((o, j) => j === i ? e.target.value : o) }))}
                      className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-white text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
                  ))}
                  <input value={newQ.correct_answer ?? ''} placeholder={t('courses.builder.correctAnswer')}
                    onChange={e => setNewQ(p => ({ ...p, correct_answer: e.target.value }))}
                    className="col-span-2 px-3 py-2 rounded-lg bg-slate-900 border border-green-600/50 text-white text-sm focus:outline-none focus:ring-1 focus:ring-green-500" />
                </div>
              )}
              {newQ.type === 'true_false' && (
                <select value={newQ.correct_answer ?? 'True'}
                  onChange={e => setNewQ(p => ({ ...p, correct_answer: e.target.value }))}
                  className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-white text-sm focus:outline-none focus:ring-1 focus:ring-blue-500">
                  <option value="True">{t('courses.builder.trueLabel')}</option>
                  <option value="False">{t('courses.builder.falseLabel')}</option>
                </select>
              )}
              {newQ.type === 'essay' && (
                <p className="text-slate-500 text-xs">{t('courses.builder.essayNote')}</p>
              )}
              <Button onClick={addManualQuestion} size="sm">{t('courses.builder.addQuestion')}</Button>
            </div>
          ) : (
            <button onClick={() => setShowAddQ(true)}
              className="w-full py-2.5 rounded-lg border-2 border-dashed border-slate-700 text-slate-400 hover:border-slate-500 hover:text-white text-sm transition-colors flex items-center justify-center gap-2">
              <Plus className="w-4 h-4" /> {t('lessonDetail.addManually')}
            </button>
          )}

          <div className="flex gap-3 pt-2 sticky bottom-0 bg-slate-900 pb-1">
            <Button variant="secondary" onClick={() => { setShowHwModal(false); setQuestions([]) }} className="flex-1">{t('lessonDetail.cancelHomework')}</Button>
            <Button onClick={saveHomework} loading={hwLoading} disabled={!hwForm.title || questions.length === 0} className="flex-1">
              {t('lessonDetail.saveHomework', { count: questions.length })}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
