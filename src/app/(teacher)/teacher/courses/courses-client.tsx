'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Plus, BookOpen, Layers, Users, Pencil, Trash2, Eye, EyeOff, GraduationCap } from 'lucide-react'
import { formatDate } from '@/lib/utils'

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

interface Props {
  initialCourses: Course[]
  teacherId: string
  tenantId: string
}

export function CoursesClient({ initialCourses, tenantId }: Props) {
  const [courses, setCourses] = useState(initialCourses)
  const [showAdd, setShowAdd] = useState(false)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    title: '',
    description: '',
    language: '',
    has_levels: true,
  })
  const supabase = createClient()
  const router = useRouter()

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const { data, error } = await supabase
      .from('courses')
      .insert({
        title: form.title,
        description: form.description || null,
        language: form.language || null,
        has_levels: form.has_levels,
        tenant_id: tenantId,
      })
      .select('*, course_levels(count), course_enrollments(count)')
      .single()
    if (!error && data) {
      setCourses(prev => [data, ...prev])
      setForm({ title: '', description: '', language: '', has_levels: true })
      setShowAdd(false)
    }
    setLoading(false)
  }

  async function togglePublish(course: Course) {
    const { data } = await supabase
      .from('courses')
      .update({ is_published: !course.is_published })
      .eq('id', course.id)
      .select('*, course_levels(count), course_enrollments(count)')
      .single()
    if (data) setCourses(prev => prev.map(c => c.id === course.id ? data : c))
  }

  async function deleteCourse(id: string) {
    if (!confirm('Delete this course? All levels, units, and content will be permanently removed.')) return
    await supabase.from('courses').delete().eq('id', id)
    setCourses(prev => prev.filter(c => c.id !== id))
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">My Courses</h2>
          <p className="text-slate-400 mt-1">{courses.length} courses · Continuing Education Center</p>
        </div>
        <Button onClick={() => setShowAdd(true)}>
          <Plus className="w-4 h-4" /> New Course
        </Button>
      </div>

      {courses.length === 0 ? (
        <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl">
          <GraduationCap className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400 mb-1">No courses yet.</p>
          <p className="text-slate-500 text-sm">Create your first continuing education course.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {courses.map(course => (
            <div key={course.id} className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition-colors">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-xl bg-violet-600/20 flex items-center justify-center shrink-0">
                  <GraduationCap className="w-5 h-5 text-violet-400" />
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={course.is_published ? 'green' : 'yellow'}>
                    {course.is_published ? 'Published' : 'Draft'}
                  </Badge>
                </div>
              </div>

              <h3 className="text-white font-semibold mb-1">{course.title}</h3>
              {course.description && (
                <p className="text-slate-400 text-sm mb-2 line-clamp-2">{course.description}</p>
              )}

              <div className="flex items-center gap-3 mb-4 text-xs text-slate-500">
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

              <p className="text-slate-600 text-xs mb-4">Created {formatDate(course.created_at)}</p>

              <div className="space-y-2 pt-3 border-t border-slate-800">
                <Button
                  className="w-full"
                  onClick={() => router.push(`/teacher/courses/${course.id}`)}
                >
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
            <label className="block text-sm font-medium text-slate-300">Description (optional)</label>
            <textarea
              value={form.description}
              onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
              rows={3}
              className="w-full px-4 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-none"
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
            <label className="block text-sm font-medium text-slate-300">Course Structure</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setForm(p => ({ ...p, has_levels: true }))}
                className={`p-3 rounded-lg border text-left transition-colors ${
                  form.has_levels
                    ? 'border-violet-500 bg-violet-500/10 text-white'
                    : 'border-slate-700 bg-slate-800 text-slate-400 hover:border-slate-600'
                }`}
              >
                <Layers className="w-4 h-4 mb-1.5 text-violet-400" />
                <p className="text-sm font-medium">Leveled</p>
                <p className="text-xs text-slate-500 mt-0.5">Course → Levels → Units → Content</p>
                <p className="text-xs text-slate-600 mt-0.5">Best for: languages, long programs</p>
              </button>
              <button
                type="button"
                onClick={() => setForm(p => ({ ...p, has_levels: false }))}
                className={`p-3 rounded-lg border text-left transition-colors ${
                  !form.has_levels
                    ? 'border-blue-500 bg-blue-500/10 text-white'
                    : 'border-slate-700 bg-slate-800 text-slate-400 hover:border-slate-600'
                }`}
              >
                <BookOpen className="w-4 h-4 mb-1.5 text-blue-400" />
                <p className="text-sm font-medium">Flat</p>
                <p className="text-xs text-slate-500 mt-0.5">Course → Units → Content</p>
                <p className="text-xs text-slate-600 mt-0.5">Best for: short courses, workshops</p>
              </button>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setShowAdd(false)} className="flex-1">Cancel</Button>
            <Button type="submit" loading={loading} className="flex-1">Create Course</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
