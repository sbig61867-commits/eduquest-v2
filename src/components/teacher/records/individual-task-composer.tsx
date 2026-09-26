'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Camera, ImagePlus, Plus, Send, Sparkles, Trash2, X } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import { extractFilesText } from '@/lib/ai/extract-client'
import { prepareImageForUpload } from '@/lib/prepare-image'
import { weaknessNote, writtenAnswersText, type TaskSuggestion } from '@/lib/individual-task'
import { selectClass } from '@/components/teacher/records/ui'

// Sends ONE student a follow-up task of their own (their weak points, what to
// rework, optional images). Two halves:
//   1. what the student wrote — their answer on the platform, or a photo of
//      their paper read with OCR — fed on demand to the free "suggest" draft;
//   2. what the student will receive — always edited by the teacher, never
//      sent automatically.
// Only the second half leaves this dialog (POST /api/exams/individual).

interface Source { id: string; title: string }
interface DraftQuestion { key: string; text: string; points: number }
interface Attachment { path: string; url: string }

const MAX_ATTACHMENTS = 6
const MAX_QUESTIONS = 20
let seq = 0
const newQuestion = (text = ''): DraftQuestion => ({ key: `q${++seq}`, text, points: 5 })

const area = 'w-full px-3 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y'

export function IndividualTaskComposer({ open, onClose, groupId, student, sources, initialSourceId }: {
  open: boolean
  onClose: () => void
  groupId: string
  student: { id: string; name: string }
  /** The group's own exams/homework, to name what the task follows up. */
  sources: Source[]
  initialSourceId?: string
}) {
  const t = useTranslations('teacher.records.individual')
  const tAi = useTranslations('common.ai')
  const router = useRouter()

  const [sourceId, setSourceId] = useState(initialSourceId ?? '')
  const [answer, setAnswer] = useState('')
  const [question, setQuestion] = useState('')
  const [notes, setNotes] = useState('')
  const [attachPaper, setAttachPaper] = useState(true)
  const [busy, setBusy] = useState<'' | 'answer' | 'ocr' | 'ai' | 'upload' | 'send'>('')

  const [title, setTitle] = useState('')
  const [instructions, setInstructions] = useState('')
  const [questions, setQuestions] = useState<DraftQuestion[]>(() => [newQuestion()])
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [due, setDue] = useState('')
  const [graded, setGraded] = useState(true)

  const paperRef = useRef<HTMLInputElement>(null)
  const imageRef = useRef<HTMLInputElement>(null)

  async function uploadImage(file: File): Promise<Attachment | null> {
    const ready = await prepareImageForUpload(file)
    const fd = new FormData()
    fd.append('file', ready)
    const res = await fetch('/api/exams/files', { method: 'POST', body: fd })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.path) { toast.error(data.error ?? t('uploadFailed')); return null }
    return { path: data.path, url: data.url }
  }

  async function addImages(files: File[], kind: 'upload' | 'ocr') {
    const room = MAX_ATTACHMENTS - attachments.length
    if (room <= 0) { toast.warning(t('tooManyImages', { max: MAX_ATTACHMENTS })); return }
    const picked = files.slice(0, room)
    const added: Attachment[] = []
    for (const f of picked) {
      try {
        const a = await uploadImage(f)
        if (a) added.push(a)
      } catch { toast.error(t('uploadFailed')) }
    }
    if (added.length) setAttachments(prev => [...prev, ...added])
    if (kind === 'upload') setBusy('')
  }

  /** The student's answers to the chosen exam on the platform, as text. */
  async function loadPlatformAnswer() {
    if (!sourceId) return
    setBusy('answer')
    const res = await fetch(`/api/exams/results?exam_id=${sourceId}`)
    const data = await res.json().catch(() => ({}))
    setBusy('')
    if (!res.ok) { toast.error(data.error ?? t('answerLoadFailed')); return }
    const row = (data.results ?? []).find((r: { student_id: string }) => r.student_id === student.id)
    const text = row ? writtenAnswersText(data.questions ?? [], row.answers ?? {}) : { question: '', answer: '' }
    if (!text.answer) { toast.warning(t('noPlatformAnswer')); return }
    setAnswer(text.answer)
    setQuestion(text.question)
  }

  /** A photo of the paper: read its text (OCR), and optionally attach it to the task. */
  async function readPaper(files: File[]) {
    if (files.length === 0) return
    setBusy('ocr')
    const extracted = await extractFilesText(files, tAi)
    if ('error' in extracted) toast.error(extracted.error)
    else setAnswer(prev => [prev.trim(), extracted.combined.trim()].filter(Boolean).join('\n\n'))
    // Only pictures can be shown to the student; a scanned PDF is read, not attached.
    const images = files.filter(f => f.type.startsWith('image/'))
    if (attachPaper && images.length) await addImages(images, 'ocr')
    setBusy('')
  }

  async function suggest() {
    if (!answer.trim()) { toast.warning(t('answerFirst')); return }
    setBusy('ai')
    const res = await fetch('/api/ai/individual-task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        answer, question, notes,
        exam_title: sources.find(s => s.id === sourceId)?.title ?? '',
      }),
    })
    const data = await res.json().catch(() => ({})) as Partial<TaskSuggestion> & { error?: string }
    setBusy('')
    if (!res.ok || !data.weaknesses || !data.questions) { toast.error(data.error ?? t('suggestFailed')); return }
    setTitle(data.title || title)
    setInstructions(weaknessNote(data.weaknesses, data.instructions ?? ''))
    setQuestions(data.questions.map(q => newQuestion(q)))
  }

  async function send() {
    const qs = questions.map(q => ({ ...q, text: q.text.trim() })).filter(q => q.text)
    if (!title.trim()) { toast.warning(t('titleRequired')); return }
    if (qs.length === 0) { toast.warning(t('questionRequired')); return }
    setBusy('send')
    const res = await fetch('/api/exams/individual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        student_id: student.id,
        group_id: groupId,
        source_exam_id: sourceId || null,
        title: title.trim(),
        instructions: instructions.trim(),
        questions: qs.map(q => ({ text: q.text, type: 'essay', points: q.points })),
        attachments: attachments.map(a => a.path),
        // datetime-local is the teacher's local time; send an absolute instant.
        due_date: due ? new Date(due).toISOString() : null,
        counts_toward_grade: graded,
      }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy('')
    if (!res.ok) { toast.error(data.error ?? t('sendFailed')); return }
    toast.success(t('sent', { name: student.name }))
    onClose()
    router.refresh()
  }

  const working = busy !== ''

  return (
    <Modal open={open} onClose={() => !working && onClose()} title={t('title', { name: student.name })} size="xl">
      <div className="space-y-6 max-h-[75vh] overflow-y-auto pe-1">
        {/* 1 — what the student wrote */}
        <section className="space-y-3 rounded-xl border border-slate-700 p-4">
          <h3 className="text-white font-semibold text-sm">{t('step1')}</h3>
          <div className="grid sm:grid-cols-[1fr_auto] gap-2 items-end">
            <label className="space-y-1.5">
              <span className="block text-sm text-slate-300">{t('sourceLabel')}</span>
              <select value={sourceId} onChange={e => setSourceId(e.target.value)} className={`${selectClass} w-full`}>
                <option value="">{t('sourceNone')}</option>
                {sources.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
            </label>
            <Button type="button" variant="secondary" size="sm" disabled={!sourceId || working} loading={busy === 'answer'} onClick={loadPlatformAnswer}>
              {t('usePlatformAnswer')}
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <input ref={paperRef} type="file" accept="image/*,.pdf" multiple className="hidden"
              onChange={e => { const f = Array.from(e.target.files ?? []).slice(0, 3); e.target.value = ''; void readPaper(f) }} />
            <Button type="button" variant="secondary" size="sm" disabled={working} loading={busy === 'ocr'} onClick={() => paperRef.current?.click()}>
              <Camera className="w-4 h-4" />{t('readPaper')}
            </Button>
            <label className="flex items-center gap-2 text-sm text-slate-300 select-none">
              <input type="checkbox" checked={attachPaper} onChange={e => setAttachPaper(e.target.checked)} className="accent-blue-500" />
              {t('attachPaper')}
            </label>
          </div>
          <p className="text-slate-500 text-xs">{t('ocrHint')}</p>

          <label className="block space-y-1.5">
            <span className="block text-sm text-slate-300">{t('answerLabel')}</span>
            <textarea value={answer} onChange={e => setAnswer(e.target.value)} rows={5} className={area} placeholder={t('answerPlaceholder')} />
          </label>
          <label className="block space-y-1.5">
            <span className="block text-sm text-slate-300">{t('notesLabel')}</span>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={area} placeholder={t('notesPlaceholder')} />
          </label>
          <Button type="button" variant="secondary" size="sm" disabled={working || !answer.trim()} loading={busy === 'ai'} onClick={suggest}>
            <Sparkles className="w-4 h-4" />{t('suggest')}
          </Button>
          <p className="text-slate-500 text-xs">{t('suggestHint')}</p>
        </section>

        {/* 2 — what the student will receive */}
        <section className="space-y-3 rounded-xl border border-blue-500/30 bg-blue-500/5 p-4">
          <h3 className="text-white font-semibold text-sm">{t('step2', { name: student.name })}</h3>
          <Input label={t('taskTitle')} value={title} onChange={e => setTitle(e.target.value)} maxLength={200} placeholder={t('taskTitlePlaceholder')} />
          <label className="block space-y-1.5">
            <span className="block text-sm text-slate-300">{t('instructionsLabel')}</span>
            <textarea value={instructions} onChange={e => setInstructions(e.target.value)} rows={5} maxLength={8000} className={area} placeholder={t('instructionsPlaceholder')} />
          </label>

          <div className="space-y-2">
            <span className="block text-sm text-slate-300">{t('questionsLabel')}</span>
            {questions.map((q, i) => (
              <div key={q.key} className="flex items-start gap-2">
                <span className="text-slate-500 text-xs font-mono mt-3">{i + 1}.</span>
                <textarea
                  value={q.text} rows={2} maxLength={4000} className={`${area} flex-1`} placeholder={t('questionPlaceholder')}
                  onChange={e => setQuestions(prev => prev.map(x => x.key === q.key ? { ...x, text: e.target.value } : x))}
                />
                {graded && (
                  <input
                    type="number" min={1} max={100} value={q.points} title={t('points')}
                    onChange={e => setQuestions(prev => prev.map(x => x.key === q.key ? { ...x, points: Math.min(100, Math.max(1, Number(e.target.value) || 1)) } : x))}
                    className="w-16 px-2 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white text-sm text-center"
                  />
                )}
                <button type="button" onClick={() => setQuestions(prev => prev.length > 1 ? prev.filter(x => x.key !== q.key) : prev)}
                  className="text-slate-500 hover:text-red-400 mt-2.5" aria-label={t('removeQuestion')}>
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
            {questions.length < MAX_QUESTIONS && (
              <button type="button" onClick={() => setQuestions(prev => [...prev, newQuestion()])}
                className="inline-flex items-center gap-1.5 text-blue-400 hover:text-blue-300 text-sm">
                <Plus className="w-3.5 h-3.5" />{t('addQuestion')}
              </button>
            )}
          </div>

          <div className="space-y-2">
            <span className="block text-sm text-slate-300">{t('imagesLabel')}</span>
            {attachments.length > 0 && (
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {attachments.map((a, i) => (
                  <div key={a.path} className="relative group rounded-lg overflow-hidden border border-slate-700 bg-slate-800">
                    {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from private storage */}
                    <img src={a.url} alt={t('imageAlt', { n: i + 1 })} className="w-full h-20 object-cover" />
                    <button type="button" onClick={() => setAttachments(prev => prev.filter(x => x.path !== a.path))}
                      className="absolute top-1 end-1 p-1 rounded bg-slate-900/80 text-slate-300 hover:text-red-400" aria-label={t('removeImage')}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <input ref={imageRef} type="file" accept="image/*" multiple className="hidden"
              onChange={e => { const f = Array.from(e.target.files ?? []); e.target.value = ''; setBusy('upload'); void addImages(f, 'upload') }} />
            <Button type="button" variant="ghost" size="sm" disabled={working || attachments.length >= MAX_ATTACHMENTS} loading={busy === 'upload'} onClick={() => imageRef.current?.click()}>
              <ImagePlus className="w-4 h-4" />{t('addImage', { count: attachments.length, max: MAX_ATTACHMENTS })}
            </Button>
          </div>

          <div className="grid sm:grid-cols-2 gap-3 items-end">
            <Input label={t('dueLabel')} type="datetime-local" value={due} onChange={e => setDue(e.target.value)} />
            <label className="flex items-center gap-2 text-sm text-slate-300 select-none pb-2.5">
              <input type="checkbox" checked={graded} onChange={e => setGraded(e.target.checked)} className="accent-blue-500" />
              {t('graded')}
            </label>
          </div>
          <p className="text-slate-500 text-xs">{graded ? t('gradedHint') : t('ungradedHint')}</p>
        </section>

        <div className="flex gap-3">
          <Button type="button" variant="secondary" className="flex-1" disabled={working} onClick={onClose}>{t('cancel')}</Button>
          <Button type="button" className="flex-1" loading={busy === 'send'} disabled={working && busy !== 'send'} onClick={send}>
            <Send className="w-4 h-4" />{t('send', { name: student.name })}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
