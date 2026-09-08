'use client'
import { confirmDialog } from '@/lib/confirm-dialog'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/components/ui/toast'
import {
  Plus, BookOpen, Layers, Users, Pencil, Trash2, Eye, EyeOff,
  GraduationCap, Upload, Sparkles, ChevronDown, ChevronUp, FileText, Check
} from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { AiProgress } from '@/components/shared/ai-progress'

interface Course {
  id: string
  title: string
  description: string | null
  language: string | null
  has_levels: boolean
  is_published: boolean
  created_at: string
  course_levels: { count: number }[]
  course_enrollments: { count: number }[]
}

interface GeneratedLesson { title: string; order: number }
interface GeneratedUnit { name: string; order: number; lessons: GeneratedLesson[] }
interface GeneratedCourse {
  title: string
  description: string
  language: string
  has_levels: boolean
  units: GeneratedUnit[]
}

interface Props {
  initialCourses: Course[]
  teacherId: string
  tenantId: string
}

export function CoursesClient({ initialCourses }: Props) {
  const [courses, setCourses] = useState(initialCourses)
  const [showAdd, setShowAdd] = useState(false)
  const [showPptx, setShowPptx] = useState(false)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ title: '', description: '', language: '', has_levels: true })
  const router = useRouter()

  // PPTX flow state
  const [pptxStep, setPptxStep] = useState<'upload' | 'preview' | 'confirm'>('upload')
  const [pptxFile, setPptxFile] = useState<File | null>(null)
  const [pptxLoading, setPptxLoading] = useState(false)
  const [pptxError, setPptxError] = useState('')
  const [generatedCourse, setGeneratedCourse] = useState<GeneratedCourse | null>(null)
  const [sourceText, setSourceText] = useState('') // extracted file text — bound to AI content generation
  const [expandedUnits, setExpandedUnits] = useState<Set<number>>(new Set([0]))
  const [creating, setCreating] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const res = await fetch('/api/courses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json()
    if (res.ok) {
      setCourses(prev => [data, ...prev])
      setForm({ title: '', description: '', language: '', has_levels: true })
      setShowAdd(false)
      router.refresh()
    } else {
      toast.error(data.error ?? 'Failed to create course')
    }
    setLoading(false)
  }

  async function togglePublish(course: Course) {
    const res = await fetch('/api/courses', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: course.id, is_published: !course.is_published }),
    })
    const data = await res.json()
    if (res.ok) { setCourses(prev => prev.map(c => c.id === course.id ? data : c)); router.refresh() }
  }

  async function deleteCourse(id: string) {
    if (!(await confirmDialog('Delete this course? All levels, units, and content will be permanently removed.'))) return
    const res = await fetch('/api/courses', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (res.ok) { setCourses(prev => prev.filter(c => c.id !== id)); router.refresh() }
  }

  // ── PPTX flow ──

  function openPptxModal() {
    setPptxStep('upload')
    setPptxFile(null)
    setPptxError('')
    setGeneratedCourse(null)
    setExpandedUnits(new Set([0]))
    setShowPptx(true)
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null
    setPptxFile(f)
    setPptxError('')
  }

  async function handlePptxUpload() {
    if (!pptxFile) return
    setPptxLoading(true)
    setPptxError('')
    try {
      const fd = new FormData()
      fd.append('file', pptxFile)
      const res = await fetch('/api/ai/generate-course-pptx', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) {
        setPptxError(data.error ?? 'Failed to process file')
      } else {
        setGeneratedCourse(data.course)
        setSourceText(data.sourceText ?? '')
        setPptxStep('preview')
      }
    } catch {
      setPptxError('Network error. Please try again.')
    }
    setPptxLoading(false)
  }

  function toggleUnit(idx: number) {
    setExpandedUnits(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  function updateUnitName(idx: number, name: string) {
    if (!generatedCourse) return
    setGeneratedCourse({
      ...generatedCourse,
      units: generatedCourse.units.map((u, i) => i === idx ? { ...u, name } : u),
    })
  }

  function updateLessonTitle(unitIdx: number, lessonIdx: number, title: string) {
    if (!generatedCourse) return
    setGeneratedCourse({
      ...generatedCourse,
      units: generatedCourse.units.map((u, i) =>
        i === unitIdx ? {
          ...u,
          lessons: u.lessons.map((l, j) => j === lessonIdx ? { ...l, title } : l),
        } : u
      ),
    })
  }

  async function handleConfirmCreate() {
    if (!generatedCourse) return
    setCreating(true)
    try {
      const res = await fetch('/api/courses/create-full', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ course: generatedCourse, source_text: sourceText }),
      })
      const data = await res.json()
      if (res.ok) {
        setCourses(prev => [data, ...prev])
        setShowPptx(false)
        setPptxStep('upload')
        setGeneratedCourse(null)
        router.refresh()
      } else {
        toast.error(data.error ?? 'Failed to create course')
      }
    } catch {
      toast.error('Network error. Please try again.')
    }
    setCreating(false)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-fg">My Courses</h2>
          <p className="text-fg-secondary mt-1">{courses.length} courses · Continuing Education Center</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={openPptxModal}>
            <Upload className="w-4 h-4" /> Import from PPTX
          </Button>
          <Button onClick={() => setShowAdd(true)}>
            <Plus className="w-4 h-4" /> New Course
          </Button>
        </div>
      </div>

      {/* Course grid */}
      {courses.length === 0 ? (
        <div className="text-center py-20 bg-surface border border-border rounded-lg">
          <GraduationCap className="w-12 h-12 text-fg-muted mx-auto mb-3" />
          <p className="text-fg-secondary mb-1">No courses yet.</p>
          <p className="text-fg-muted text-sm">Create manually or import from a PowerPoint file.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {courses.map(course => (
            <div key={course.id} className="bg-surface border border-border rounded-lg p-5 hover:border-border-strong transition-colors">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-lg bg-accent-subtle flex items-center justify-center shrink-0">
                  <GraduationCap className="w-5 h-5 text-accent" />
                </div>
                <Badge variant={course.is_published ? 'success' : 'warning'}>
                  {course.is_published ? 'Published' : 'Draft'}
                </Badge>
              </div>
              <h3 className="text-fg font-semibold mb-1">{course.title}</h3>
              {course.description && (
                <p className="text-fg-secondary text-sm mb-2 line-clamp-2">{course.description}</p>
              )}
              <div className="flex items-center gap-3 mb-4 text-xs text-fg-muted">
                {course.language && (
                  <span className="flex items-center gap-1"><BookOpen className="w-3 h-3" />{course.language}</span>
                )}
                <span className="flex items-center gap-1">
                  <Layers className="w-3 h-3" />
                  {course.has_levels ? 'Leveled' : 'Flat'}
                </span>
                <span className="flex items-center gap-1">
                  <Users className="w-3 h-3" />
                  {course.course_enrollments?.[0]?.count ?? 0} enrolled
                </span>
              </div>
              <p className="text-fg-muted text-xs mb-4">Created {formatDate(course.created_at)}</p>
              <div className="space-y-2 pt-3 border-t border-border">
                <Button className="w-full" onClick={() => router.push(`/teacher/courses/${course.id}`)}>
                  <Pencil className="w-4 h-4" /> Build Course
                </Button>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" className="flex-1" onClick={() => togglePublish(course)}>
                    {course.is_published
                      ? <><EyeOff className="w-3.5 h-3.5" /> Unpublish</>
                      : <><Eye className="w-3.5 h-3.5" /> Publish</>}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => deleteCourse(course.id)} className="hover:text-red-400 hover:bg-red-500/10">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Manual create modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="New Course">
        <form onSubmit={handleCreate} className="space-y-4">
          <Input
            label="Course Title"
            value={form.title}
            onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
            required
            placeholder="e.g. English for Beginners"
          />
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-fg-secondary">Description (optional)</label>
            <textarea
              value={form.description}
              onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
              rows={3}
              className="w-full px-4 py-2.5 rounded-lg bg-surface border border-border-strong text-fg placeholder-fg-muted focus:outline-none focus:ring-2 focus:ring-accent text-sm resize-none"
              placeholder="Brief description of this course..."
            />
          </div>
          <Input
            label="Language / Subject (optional)"
            value={form.language}
            onChange={e => setForm(p => ({ ...p, language: e.target.value }))}
            placeholder="e.g. English, Arabic, Python..."
          />
          <div className="space-y-2">
            <label className="block text-sm font-medium text-fg-secondary">Course Structure</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setForm(p => ({ ...p, has_levels: true }))}
                className={`p-3 rounded-lg border text-left transition-colors ${form.has_levels ? 'border-accent bg-accent-subtle text-fg' : 'border-border-strong bg-surface text-fg-secondary hover:border-border-strong'}`}
              >
                <Layers className="w-4 h-4 mb-1.5 text-accent" />
                <p className="text-sm font-medium">Leveled</p>
                <p className="text-xs text-fg-muted mt-0.5">Course → Levels → Units → Content</p>
              </button>
              <button
                type="button"
                onClick={() => setForm(p => ({ ...p, has_levels: false }))}
                className={`p-3 rounded-lg border text-left transition-colors ${!form.has_levels ? 'border-accent bg-accent-subtle text-fg' : 'border-border-strong bg-surface text-fg-secondary hover:border-border-strong'}`}
              >
                <BookOpen className="w-4 h-4 mb-1.5 text-accent" />
                <p className="text-sm font-medium">Flat</p>
                <p className="text-xs text-fg-muted mt-0.5">Course → Units → Content</p>
              </button>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setShowAdd(false)} className="flex-1">Cancel</Button>
            <Button type="submit" loading={loading} className="flex-1">Create Course</Button>
          </div>
        </form>
      </Modal>

      {/* PPTX Import Modal */}
      <Modal open={showPptx} onClose={() => { if (!pptxLoading && !creating) setShowPptx(false) }} title="Import Course from PowerPoint" size="xl">
        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-6">
          {(['upload', 'preview', 'confirm'] as const).map((step, i) => (
            <div key={step} className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                pptxStep === step ? 'bg-accent text-accent-fg' :
                (['upload', 'preview', 'confirm'].indexOf(pptxStep) > i) ? 'bg-green-600 text-fg' :
                'bg-surface text-fg-muted'
              }`}>
                {(['upload', 'preview', 'confirm'].indexOf(pptxStep) > i) ? <Check className="w-3.5 h-3.5" /> : i + 1}
              </div>
              <span className={`text-xs ${pptxStep === step ? 'text-fg font-medium' : 'text-fg-muted'}`}>
                {step === 'upload' ? 'رفع الملف' : step === 'preview' ? 'مراجعة الهيكل' : 'إنشاء الكورس'}
              </span>
              {i < 2 && <div className="w-8 h-px bg-border-strong" />}
            </div>
          ))}
        </div>

        {/* Step 1: Upload */}
        {pptxStep === 'upload' && (
          <div className="space-y-4">
            <div
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${
                pptxFile ? 'border-accent bg-accent-subtle' : 'border-border-strong hover:border-border-strong'
              }`}
            >
              {pptxFile ? (
                <div className="flex flex-col items-center gap-2">
                  <FileText className="w-10 h-10 text-accent" />
                  <p className="text-fg font-medium">{pptxFile.name}</p>
                  <p className="text-fg-muted text-sm">{(pptxFile.size / 1024 / 1024).toFixed(1)} MB · Click to change</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <Upload className="w-10 h-10 text-fg-muted" />
                  <p className="text-fg-secondary font-medium">Click to select a file</p>
                  <p className="text-fg-muted text-sm">PPTX · DOCX · PDF — Maximum 20 MB</p>
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pptx,.docx,.pdf"
              className="hidden"
              onChange={handleFileChange}
            />

            {pptxError && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm">
                {pptxError}
              </div>
            )}

            <AiProgress active={pptxLoading} />

            <div className="bg-surface/60 rounded-lg px-4 py-3 flex items-start gap-2">
              <Sparkles className="w-4 h-4 text-accent mt-0.5 shrink-0" />
              <p className="text-fg-secondary text-sm">
                الذكاء الاصطناعي سيستخرج نص الشرائح تلقائياً ويولد هيكل الكورس (وحدات + دروس) بناءً على المحتوى.
              </p>
            </div>

            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setShowPptx(false)} className="flex-1">إلغاء</Button>
              <Button
                onClick={handlePptxUpload}
                loading={pptxLoading}
                disabled={!pptxFile}
                className="flex-1"
              >
                <Sparkles className="w-4 h-4" />
                {pptxLoading ? 'جاري المعالجة...' : 'توليد هيكل الكورس'}
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Preview & Edit */}
        {pptxStep === 'preview' && generatedCourse && (
          <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
            <div className="bg-green-500/10 border border-green-500/20 rounded-lg px-4 py-3 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-green-400 shrink-0" />
              <p className="text-green-400 text-sm">تم توليد هيكل الكورس. راجع المحتوى وعدّل ما تريد قبل الإنشاء.</p>
            </div>

            {/* Course info */}
            <div className="space-y-3">
              <Input
                label="عنوان الكورس"
                value={generatedCourse.title}
                onChange={e => setGeneratedCourse({ ...generatedCourse, title: e.target.value })}
              />
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-fg-secondary">الوصف</label>
                <textarea
                  value={generatedCourse.description}
                  onChange={e => setGeneratedCourse({ ...generatedCourse, description: e.target.value })}
                  rows={2}
                  className="w-full px-4 py-2.5 rounded-lg bg-surface border border-border-strong text-fg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
              <div className="flex gap-3 text-sm text-fg-secondary">
                <span className="flex items-center gap-1.5">
                  <BookOpen className="w-3.5 h-3.5" /> {generatedCourse.language}
                </span>
                <span className="flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5" /> {generatedCourse.units.length} وحدة
                </span>
              </div>
            </div>

            {/* Units */}
            <div className="space-y-2">
              <p className="text-sm font-medium text-fg-secondary">الوحدات والدروس</p>
              {generatedCourse.units.map((unit, ui) => (
                <div key={ui} className="bg-surface/50 border border-border-strong rounded-lg overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggleUnit(ui)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface transition-colors"
                  >
                    <span className="w-6 h-6 rounded-full bg-accent-subtle text-accent text-xs flex items-center justify-center font-bold shrink-0">
                      {ui + 1}
                    </span>
                    <span className="text-fg text-sm font-medium flex-1">{unit.name}</span>
                    <span className="text-fg-muted text-xs">{unit.lessons.length} دروس</span>
                    {expandedUnits.has(ui) ? <ChevronUp className="w-4 h-4 text-fg-muted" /> : <ChevronDown className="w-4 h-4 text-fg-muted" />}
                  </button>

                  {expandedUnits.has(ui) && (
                    <div className="px-4 pb-3 space-y-2 border-t border-border-strong pt-3">
                      <input
                        className="w-full px-3 py-1.5 rounded-lg bg-surface border border-border-strong text-fg text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                        value={unit.name}
                        onChange={e => updateUnitName(ui, e.target.value)}
                        placeholder="اسم الوحدة"
                      />
                      {unit.lessons.map((lesson, li) => (
                        <input
                          key={li}
                          className="w-full px-3 py-1.5 rounded-lg bg-surface border border-border-strong text-fg-secondary text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                          value={lesson.title}
                          onChange={e => updateLessonTitle(ui, li, e.target.value)}
                          placeholder={`درس ${li + 1}`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="flex gap-3 pt-2 sticky bottom-0 bg-surface pb-1">
              <Button variant="secondary" onClick={() => setPptxStep('upload')} className="flex-1">رجوع</Button>
              <Button onClick={() => setPptxStep('confirm')} className="flex-1">
                <Check className="w-4 h-4" /> تأكيد وإنشاء
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Confirm */}
        {pptxStep === 'confirm' && generatedCourse && (
          <div className="space-y-5">
            <div className="bg-surface rounded-lg p-5 space-y-3">
              <h3 className="text-fg font-bold text-lg">{generatedCourse.title}</h3>
              <p className="text-fg-secondary text-sm">{generatedCourse.description}</p>
              <div className="flex gap-4 text-sm">
                <span className="text-fg-secondary flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-accent" />
                  {generatedCourse.units.length} وحدة
                </span>
                <span className="text-fg-secondary flex items-center gap-1.5">
                  <BookOpen className="w-4 h-4 text-accent" />
                  {generatedCourse.units.reduce((s, u) => s + u.lessons.length, 0)} درس
                </span>
              </div>
            </div>

            <p className="text-fg-secondary text-sm text-center">
              سيتم إنشاء الكورس مع جميع الوحدات والدروس. يمكنك إضافة المحتوى لاحقاً.
            </p>

            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setPptxStep('preview')} className="flex-1">رجوع</Button>
              <Button onClick={handleConfirmCreate} loading={creating} className="flex-1">
                <GraduationCap className="w-4 h-4" />
                {creating ? 'جاري الإنشاء...' : 'إنشاء الكورس'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
