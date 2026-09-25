'use client'
import { confirmDialog } from '@/lib/confirm-dialog'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/components/ui/toast'
import { Plus, BookOpen, Sparkles, Pencil, Trash2, Eye, EyeOff, ExternalLink, PenLine, Upload } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { AiQuota } from '@/components/shared/ai-quota'
import { useTranslations, useLocale } from 'next-intl'
import type { Locale } from '@/i18n/config'

interface Lesson { id: string; title: string; content: string | null; is_published: boolean; created_at: string; groups: { name: string } | null }
interface Group { id: string; name: string }
interface Props { initialLessons: Lesson[]; groups: Group[] }

export function LessonsClient({ initialLessons, groups }: Props) {
  const router = useRouter()
  const t = useTranslations('teacher')
  const locale = useLocale() as Locale
  const [lessons, setLessons] = useState(initialLessons)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Lesson | null>(null)
  const [form, setForm] = useState({ title: '', content: '', group_id: groups[0]?.id ?? '' })
  const [method, setMethod] = useState<'manual' | 'topic' | 'file'>('manual')
  const [aiTopic, setAiTopic] = useState('')
  const [aiLevel, setAiLevel] = useState('undergraduate')
  const [aiInstructions, setAiInstructions] = useState('')
  const [showAiInstructions, setShowAiInstructions] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [quotaToken, setQuotaToken] = useState(0)
  const [showQuota, setShowQuota] = useState(false)
  const [aiError, setAiError] = useState('')
  const [formError, setFormError] = useState('')
  const [loading, setLoading] = useState(false)
  function openAdd() { setForm({ title: '', content: '', group_id: groups[0]?.id ?? '' }); setEditing(null); setMethod('manual'); setAiTopic(''); setAiError(''); setFormError(''); setShowModal(true) }
  function openEdit(l: Lesson) { setForm({ title: l.title, content: l.content ?? '', group_id: '' }); setEditing(l); setMethod('manual'); setAiError(''); setFormError(''); setShowModal(true) }

  async function generateWithAI() {
    if (!aiTopic) return
    setAiLoading(true)
    setAiError('')
    try {
      const res = await fetch('/api/ai/generate-lesson', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: aiTopic, level: aiLevel, customInstructions: aiInstructions }),
      })
      const data = await res.json()
      if (res.ok && data.content) {
        setForm(p => ({ ...p, content: data.content, title: p.title || aiTopic }))
      } else if (res.status === 429) {
        setAiError(data.error)
        setShowQuota(true)
      } else {
        setAiError(data.error)
      }
    } catch {
      setAiError('')
    }
    setQuotaToken(t => t + 1)
    setAiLoading(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setFormError('')
    try {
      if (editing) {
        const res = await fetch('/api/lessons', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editing.id, title: form.title, content: form.content }),
        })
        const data = await res.json()
        if (!res.ok) { setFormError(data.error); setLoading(false); return }
        setLessons(prev => prev.map(l => l.id === editing.id ? data : l))
      } else {
        const res = await fetch('/api/lessons', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: form.title, content: form.content, group_id: form.group_id }),
        })
        const data = await res.json()
        if (!res.ok) { setFormError(data.error); setLoading(false); return }
        setLessons(prev => [data, ...prev])
        if (method === 'file') {
          setShowModal(false)
          router.push(`/teacher/lessons/${data.id}?generate=file`)
          return
        }
      }
      setShowModal(false)
      router.refresh()
    } catch {
      setFormError('')
    }
    setLoading(false)
  }

  async function togglePublish(lesson: Lesson) {
    const res = await fetch('/api/lessons', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: lesson.id, is_published: !lesson.is_published }),
    })
    const data = await res.json()
    if (res.ok) { setLessons(prev => prev.map(l => l.id === lesson.id ? data : l)); router.refresh() }
    else toast.error(data.error)
  }

  async function deleteLesson(id: string) {
    if (!(await confirmDialog(t('lessons.deleteConfirm')))) return
    const res = await fetch('/api/lessons', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (!res.ok) {
      toast.error((await res.json().catch(() => ({}))).error)
      return
    }
    setLessons(prev => prev.filter(l => l.id !== id))
    router.refresh()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">{t('lessons.title')}</h2>
          <p className="text-slate-400 mt-1">{t('lessons.subtitle', { count: lessons.length })}</p>
        </div>
        <Button onClick={openAdd}><Plus className="w-4 h-4" /> {t('lessons.newLesson')}</Button>
      </div>

      {lessons.length === 0 ? (
        <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl">
          <BookOpen className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400 mb-4">{t('lessons.noLessons')}</p>
          <Button onClick={openAdd} size="sm"><Sparkles className="w-4 h-4" /> {t('lessons.createAi')}</Button>
        </div>
      ) : (
        <div className="space-y-3">
          {lessons.map(lesson => (
            <div key={lesson.id} className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition-colors">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-white font-semibold truncate">{lesson.title}</h3>
                    <Badge variant={lesson.is_published ? 'green' : 'gray'}>{lesson.is_published ? t('lessons.published') : t('lessons.draft')}</Badge>
                  </div>
                  <p className="text-slate-400 text-sm">{lesson.groups?.name ?? '—'} · {formatDate(lesson.created_at, locale)}</p>
                  {lesson.content && <p className="text-slate-500 text-sm mt-2 line-clamp-2">{lesson.content.replace(/[#*`]/g, '').slice(0, 150)}...</p>}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button variant="secondary" size="sm" onClick={() => router.push(`/teacher/lessons/${lesson.id}`)}>
                    <ExternalLink className="w-3.5 h-3.5" /> {t('lessons.open')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => togglePublish(lesson)} title={lesson.is_published ? t('lessons.unpublish') : t('lessons.publish')}>
                    {lesson.is_published ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => openEdit(lesson)}><Pencil className="w-4 h-4" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => deleteLesson(lesson.id)} className="hover:text-red-400 hover:bg-red-500/10"><Trash2 className="w-4 h-4" /></Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? t('lessons.modal.editTitle') : t('lessons.modal.createTitle')} size="xl">
        <div className="space-y-5">
          {!editing && (
            <div className="grid grid-cols-3 gap-2">
              {([
                { key: 'manual', label: t('lessons.modal.methodManual'), hint: t('lessons.modal.methodManualHint'), Icon: PenLine },
                { key: 'topic',  label: t('lessons.modal.methodTopic'),  hint: t('lessons.modal.methodTopicHint'),  Icon: Sparkles },
                { key: 'file',   label: t('lessons.modal.methodFile'),   hint: t('lessons.modal.methodFileHint'),   Icon: Upload },
              ] as const).map(({ key, label, hint, Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setMethod(key)}
                  aria-pressed={method === key}
                  className={`flex flex-col items-center gap-1 rounded-xl border px-3 py-3 text-center transition-colors ${
                    method === key
                      ? 'border-blue-500 bg-blue-500/10 text-blue-300'
                      : 'border-slate-700 text-slate-400 hover:border-slate-600 hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="text-sm font-medium">{label}</span>
                  <span className="text-[11px] text-slate-500">{hint}</span>
                </button>
              ))}
            </div>
          )}

          {!editing && method === 'topic' && (
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-blue-400" />
                <span className="text-blue-400 text-sm font-medium">{t('lessons.modal.aiGenerator')}</span>
              </div>
              <button
                type="button"
                onClick={() => setShowAiInstructions(p => !p)}
                className="text-xs text-slate-400 hover:text-blue-400 transition-colors underline underline-offset-2"
              >
                {showAiInstructions ? t('lessons.modal.hideInstructions') : t('lessons.modal.showInstructions')}
              </button>
            </div>

            <p className="text-xs text-slate-400">{t('lessons.modal.aiSubtitle')}</p>

            <div className="flex flex-col sm:flex-row gap-2">
              <input value={aiTopic} onChange={e => setAiTopic(e.target.value)} maxLength={200} placeholder={t('lessons.modal.topicPlaceholder')} className="w-full sm:flex-1 min-w-0 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <div className="flex gap-2">
              <select value={aiLevel} onChange={e => setAiLevel(e.target.value)} className="flex-1 sm:flex-none min-w-0 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="high school">{t('lessons.modal.levelHighSchool')}</option>
                <option value="undergraduate">{t('lessons.modal.levelUndergrad')}</option>
                <option value="graduate">{t('lessons.modal.levelGrad')}</option>
                <option value="beginner">{t('lessons.modal.levelBeginner')}</option>
                <option value="intermediate">{t('lessons.modal.levelIntermediate')}</option>
                <option value="advanced">{t('lessons.modal.levelAdvanced')}</option>
              </select>
              <Button onClick={generateWithAI} loading={aiLoading} disabled={!aiTopic.trim()} variant="secondary" size="sm" className="shrink-0">{t('lessons.modal.generate')}</Button>
              </div>
            </div>

            {aiError && <p className="text-red-400 text-sm">{aiError}</p>}

            {showAiInstructions && (
              <div className="space-y-1.5">
                <p className="text-xs text-slate-400">{t('lessons.modal.instructionsHint')}</p>
                <textarea
                  value={aiInstructions}
                  onChange={e => setAiInstructions(e.target.value)}
                  rows={4}
                  maxLength={1000}
                  placeholder={t('lessons.modal.instructionsPlaceholder')}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
                <p className="text-xs text-slate-500 text-end">{aiInstructions.length}/1000</p>
              </div>
            )}
          </div>
          )}

          {!editing && method === 'file' && (
            <div className="bg-violet-500/10 border border-violet-500/20 rounded-xl p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Upload className="w-4 h-4 text-violet-400" />
                <span className="text-violet-300 text-sm font-medium">{t('lessons.modal.fileGenerator')}</span>
              </div>
              <p className="text-xs text-slate-400">{t('lessons.modal.fileHint')}</p>
            </div>
          )}

          {!editing && method !== 'manual' && (
            <AiQuota
              key={showQuota ? 'open' : 'closed'}
              only={['lesson', 'lesson-file']}
              refreshToken={quotaToken}
              defaultOpen={showQuota}
            />
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input label={t('lessons.modal.titleLabel')} value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} required placeholder={t('lessons.modal.titlePlaceholder')} />
            {!editing && (
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-300">{t('lessons.modal.groupLabel')}</label>
                {groups.length === 0 ? (
                  <div className="px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm">
                    {t('lessons.modal.noGroupsWarning', { link: '' })}{' '}
                    <button type="button" onClick={() => router.push('/teacher/groups')} className="underline underline-offset-2 font-medium">{t('lessons.modal.noGroupsLink')}</button>
                  </div>
                ) : (
                  <select value={form.group_id} onChange={e => setForm(p => ({ ...p, group_id: e.target.value }))} required className="w-full px-4 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                )}
              </div>
            )}
            {!(!editing && method === 'file') && (
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-300">
                  {t('lessons.modal.contentLabel')}
                  <span className="text-slate-500 font-normal"> {t('lessons.modal.contentOptional')}</span>
                </label>
                <textarea value={form.content} onChange={e => setForm(p => ({ ...p, content: e.target.value }))} rows={10} className="w-full px-4 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none font-mono" placeholder={method === 'topic' ? t('lessons.modal.contentPlaceholderTopic') : t('lessons.modal.contentPlaceholder')} />
              </div>
            )}
            {formError && <p className="text-red-400 text-sm">{formError}</p>}
            <div className="flex gap-3 pt-2">
              <Button type="button" variant="secondary" onClick={() => setShowModal(false)} className="flex-1">{t('lessons.modal.cancel')}</Button>
              <Button type="submit" loading={loading} disabled={!editing && groups.length === 0} className="flex-1">{editing ? t('lessons.modal.save') : method === 'file' ? t('lessons.modal.createAndContinue') : t('lessons.modal.createLesson')}</Button>
            </div>
          </form>
        </div>
      </Modal>
    </div>
  )
}
