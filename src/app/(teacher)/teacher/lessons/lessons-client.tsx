'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Plus, BookOpen, Sparkles, Pencil, Trash2, Eye, EyeOff, ExternalLink } from 'lucide-react'
import { formatDate } from '@/lib/utils'

interface Lesson { id: string; title: string; content: string | null; is_published: boolean; created_at: string; groups: { name: string } | null }
interface Group { id: string; name: string }
interface Props { initialLessons: Lesson[]; groups: Group[] }

export function LessonsClient({ initialLessons, groups }: Props) {
  const router = useRouter()
  const [lessons, setLessons] = useState(initialLessons)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Lesson | null>(null)
  const [form, setForm] = useState({ title: '', content: '', group_id: groups[0]?.id ?? '' })
  const [aiTopic, setAiTopic] = useState('')
  const [aiLevel, setAiLevel] = useState('undergraduate')
  const [aiInstructions, setAiInstructions] = useState('')
  const [showAiInstructions, setShowAiInstructions] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')
  const [formError, setFormError] = useState('')
  const [loading, setLoading] = useState(false)
  function openAdd() { setForm({ title: '', content: '', group_id: groups[0]?.id ?? '' }); setEditing(null); setAiError(''); setFormError(''); setShowModal(true) }
  function openEdit(l: Lesson) { setForm({ title: l.title, content: l.content ?? '', group_id: '' }); setEditing(l); setAiError(''); setFormError(''); setShowModal(true) }

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
      } else {
        setAiError(data.error ?? 'AI generation failed. Please try again.')
      }
    } catch {
      setAiError('Network error. Please check your connection and try again.')
    }
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
        if (!res.ok) { setFormError(data.error ?? 'Failed to save lesson'); setLoading(false); return }
        setLessons(prev => prev.map(l => l.id === editing.id ? data : l))
      } else {
        const res = await fetch('/api/lessons', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: form.title, content: form.content, group_id: form.group_id }),
        })
        const data = await res.json()
        if (!res.ok) { setFormError(data.error ?? 'Failed to create lesson'); setLoading(false); return }
        setLessons(prev => [data, ...prev])
      }
      setShowModal(false)
      router.refresh()
    } catch {
      setFormError('Network error. Please try again.')
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
    else alert(data.error ?? 'فشل تغيير حالة النشر')
  }

  async function deleteLesson(id: string) {
    if (!confirm('حذف هذا الدرس؟\n\nإن كان "الحذف النهائي" مفعّلاً من إعدادات المالك فسيُمحى هو وواجباته وكل تسليماتها وعلاماتها نهائياً (لا رجعة). وإلا فسيُنقل إلى الأرشيف مع حفظ كل السجلات.')) return
    const res = await fetch('/api/lessons', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (!res.ok) {
      alert((await res.json().catch(() => ({}))).error ?? 'فشل حذف الدرس')
      return
    }
    setLessons(prev => prev.filter(l => l.id !== id))
    router.refresh()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Lessons</h2>
          <p className="text-slate-400 mt-1">{lessons.length} lessons created</p>
        </div>
        <Button onClick={openAdd}><Plus className="w-4 h-4" /> New Lesson</Button>
      </div>

      {lessons.length === 0 ? (
        <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl">
          <BookOpen className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400 mb-4">No lessons yet. Create your first lesson.</p>
          <Button onClick={openAdd} size="sm"><Sparkles className="w-4 h-4" /> Create with AI</Button>
        </div>
      ) : (
        <div className="space-y-3">
          {lessons.map(lesson => (
            <div key={lesson.id} className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition-colors">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-white font-semibold truncate">{lesson.title}</h3>
                    <Badge variant={lesson.is_published ? 'green' : 'gray'}>{lesson.is_published ? 'Published' : 'Draft'}</Badge>
                  </div>
                  <p className="text-slate-400 text-sm">{lesson.groups?.name ?? '—'} · {formatDate(lesson.created_at)}</p>
                  {lesson.content && <p className="text-slate-500 text-sm mt-2 line-clamp-2">{lesson.content.replace(/[#*`]/g, '').slice(0, 150)}...</p>}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button variant="secondary" size="sm" onClick={() => router.push(`/teacher/lessons/${lesson.id}`)}>
                    <ExternalLink className="w-3.5 h-3.5" /> فتح
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => togglePublish(lesson)} title={lesson.is_published ? 'Unpublish' : 'Publish'}>
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

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Lesson' : 'New Lesson'} size="xl">
        <div className="space-y-5">
          {/* AI Generator */}
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-blue-400" />
                <span className="text-blue-400 text-sm font-medium">AI Lesson Generator</span>
              </div>
              <button
                type="button"
                onClick={() => setShowAiInstructions(p => !p)}
                className="text-xs text-slate-400 hover:text-blue-400 transition-colors underline underline-offset-2"
              >
                {showAiInstructions ? 'Hide custom instructions' : 'Add custom instructions'}
              </button>
            </div>

            <div className="flex gap-2">
              <input value={aiTopic} onChange={e => setAiTopic(e.target.value)} placeholder="Enter topic (e.g. Photosynthesis, Present Tense...)" className="flex-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <select value={aiLevel} onChange={e => setAiLevel(e.target.value)} className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="high school">High School</option>
                <option value="undergraduate">Undergraduate</option>
                <option value="graduate">Graduate</option>
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </select>
              <Button onClick={generateWithAI} loading={aiLoading} variant="secondary" size="sm">Generate</Button>
            </div>

            {aiError && <p className="text-red-400 text-sm">{aiError}</p>}

            {showAiInstructions && (
              <div className="space-y-1.5">
                <p className="text-xs text-slate-400">
                  Describe how you want the AI to structure and present this content. Leave empty to use the default structure.
                </p>
                <textarea
                  value={aiInstructions}
                  onChange={e => setAiInstructions(e.target.value)}
                  rows={4}
                  maxLength={1000}
                  placeholder={`Examples:\n• "Split into: grammar rule, examples, idioms, task, then a 5-question quiz"\n• "University lecture with theory, case studies, discussion points, and references"\n• "Step-by-step tutorial with code examples and explanations"`}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
                <p className="text-xs text-slate-500 text-right">{aiInstructions.length}/1000</p>
              </div>
            )}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input label="Lesson Title" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} required placeholder="Introduction to..." />
            {!editing && (
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-300">Group</label>
                {groups.length === 0 ? (
                  <div className="px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm">
                    You don&apos;t have any groups yet. Create a group first from{' '}
                    <button type="button" onClick={() => router.push('/teacher/groups')} className="underline underline-offset-2 font-medium">My Groups</button>
                    {' '}— lessons must belong to a group so students can see them.
                  </div>
                ) : (
                  <select value={form.group_id} onChange={e => setForm(p => ({ ...p, group_id: e.target.value }))} required className="w-full px-4 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                )}
              </div>
            )}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-300">Content (Markdown supported)</label>
              <textarea value={form.content} onChange={e => setForm(p => ({ ...p, content: e.target.value }))} rows={10} required className="w-full px-4 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none font-mono" placeholder="Write lesson content or generate with AI above..." />
            </div>
            {formError && <p className="text-red-400 text-sm">{formError}</p>}
            <div className="flex gap-3 pt-2">
              <Button type="button" variant="secondary" onClick={() => setShowModal(false)} className="flex-1">Cancel</Button>
              <Button type="submit" loading={loading} disabled={!editing && groups.length === 0} className="flex-1">{editing ? 'Save Changes' : 'Create Lesson'}</Button>
            </div>
          </form>
        </div>
      </Modal>
    </div>
  )
}
