'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  ChevronLeft, Plus, Layers, BookOpen,
  Trash2, ChevronDown, ChevronRight, Sparkles,
} from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────────────────

interface UnitItem {
  id: string
  title: string
  type: string
  order_index: number
  is_published: boolean
  content: Record<string, unknown>
}

interface CourseUnit {
  id: string
  title: string
  order_index: number
  is_published: boolean
  level_id: string | null
  unit_items: UnitItem[]
}

interface CourseLevel {
  id: string
  title: string
  order_index: number
  is_published: boolean
  course_units: CourseUnit[]
}

interface Course {
  id: string
  title: string
  description: string | null
  language: string | null
  has_levels: boolean
  is_published: boolean
  tenant_id: string
}

interface Props {
  course: Course
  initialLevels: CourseLevel[]
  initialFlatUnits: CourseUnit[]
}

const ITEM_TYPES = [
  { value: 'text',     label: 'Text / Explanation' },
  { value: 'grammar',  label: 'Grammar Rule' },
  { value: 'idioms',   label: 'Idioms & Phrases' },
  { value: 'rules',    label: 'Rules & Notes' },
  { value: 'task',     label: 'Task / Exercise' },
  { value: 'quiz',     label: 'Quiz' },
  { value: 'video',    label: 'Video' },
]

// ── Main Component ───────────────────────────────────────────────────────────

export function CourseBuildClient({ course, initialLevels, initialFlatUnits }: Props) {
  const [levels,    setLevels]    = useState(initialLevels)
  const [flatUnits, setFlatUnits] = useState(initialFlatUnits)
  const [expanded,  setExpanded]  = useState<Record<string, boolean>>({})
  const [aiLoading, setAiLoading] = useState(false)

  // Modal state
  const [levelModal, setLevelModal]   = useState(false)
  const [unitModal,  setUnitModal]    = useState<{ open: boolean; levelId: string | null }>({ open: false, levelId: null })
  const [itemModal,  setItemModal]    = useState<{ open: boolean; unitId: string | null }>({ open: false, unitId: null })
  const [itemForm,   setItemForm]     = useState({ title: '', type: 'text', body: '', aiTopic: '' })
  const [levelForm,  setLevelForm]    = useState({ title: '' })
  const [unitForm,   setUnitForm]     = useState({ title: '' })
  const [saving,     setSaving]       = useState(false)

  const supabase = createClient()
  const router   = useRouter()

  function toggle(id: string) {
    setExpanded(p => ({ ...p, [id]: !p[id] }))
  }

  // ── Level CRUD ────────────────────────────────────────────────────────────

  async function addLevel(e: React.FormEvent) {
    e.preventDefault(); setSaving(true)
    const { data } = await supabase.from('course_levels').insert({
      course_id: course.id, tenant_id: course.tenant_id,
      title: levelForm.title, order_index: levels.length,
    }).select('*, course_units(*, unit_items(*))').single()
    if (data) setLevels(p => [...p, data])
    setLevelForm({ title: '' }); setLevelModal(false); setSaving(false)
  }

  async function deleteLevel(id: string) {
    if (!confirm('Delete this level and all its units?')) return
    await supabase.from('course_levels').delete().eq('id', id)
    setLevels(p => p.filter(l => l.id !== id))
  }

  // ── Unit CRUD ─────────────────────────────────────────────────────────────

  async function addUnit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true)
    const levelId = unitModal.levelId
    const existingUnits = levelId
      ? levels.find(l => l.id === levelId)?.course_units ?? []
      : flatUnits
    const { data } = await supabase.from('course_units').insert({
      course_id: course.id, tenant_id: course.tenant_id,
      level_id: levelId, title: unitForm.title,
      order_index: existingUnits.length,
    }).select('*, unit_items(*)').single()
    if (data) {
      if (levelId) {
        setLevels(p => p.map(l => l.id === levelId
          ? { ...l, course_units: [...l.course_units, data] }
          : l))
      } else {
        setFlatUnits(p => [...p, data])
      }
      setExpanded(p => ({ ...p, [levelId ?? 'flat']: true }))
    }
    setUnitForm({ title: '' }); setUnitModal({ open: false, levelId: null }); setSaving(false)
  }

  async function deleteUnit(unitId: string, levelId: string | null) {
    if (!confirm('Delete this unit and all its content?')) return
    await supabase.from('course_units').delete().eq('id', unitId)
    if (levelId) {
      setLevels(p => p.map(l => l.id === levelId
        ? { ...l, course_units: l.course_units.filter(u => u.id !== unitId) }
        : l))
    } else {
      setFlatUnits(p => p.filter(u => u.id !== unitId))
    }
  }

  // ── Item CRUD ─────────────────────────────────────────────────────────────

  // Generate this section's content STRICTLY from the course's uploaded file.
  // Uses the item Title as the section to write — no outside/internet knowledge.
  async function generateItemContent() {
    const title = itemForm.title.trim() || itemForm.aiTopic.trim()
    if (!title) { alert('اكتب عنوان القسم أولاً ليُولّد محتواه من ملف الكورس.'); return }
    setAiLoading(true)
    const res = await fetch('/api/courses/generate-item-content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ course_id: course.id, title }),
    })
    const data = await res.json()
    if (res.ok && data.content) {
      setItemForm(p => ({ ...p, body: data.content, title: p.title || title }))
    } else {
      alert(data.error ?? 'فشل توليد المحتوى')
    }
    setAiLoading(false)
  }

  async function addItem(e: React.FormEvent) {
    e.preventDefault(); setSaving(true)
    const unitId = itemModal.unitId!
    const { data } = await supabase.from('unit_items').insert({
      unit_id: unitId, course_id: course.id, tenant_id: course.tenant_id,
      title: itemForm.title, type: itemForm.type,
      content: { body: itemForm.body },
      order_index: 0,
    }).select().single()
    if (data) {
      const updateUnit = (units: CourseUnit[]) =>
        units.map(u => u.id === unitId
          ? { ...u, unit_items: [data, ...u.unit_items] }
          : u)
      setLevels(p => p.map(l => ({ ...l, course_units: updateUnit(l.course_units) })))
      setFlatUnits(updateUnit)
    }
    setItemForm({ title: '', type: 'text', body: '', aiTopic: '' })
    setItemModal({ open: false, unitId: null }); setSaving(false)
  }

  async function deleteItem(itemId: string, unitId: string) {
    await supabase.from('unit_items').delete().eq('id', itemId)
    const removeItem = (units: CourseUnit[]) =>
      units.map(u => u.id === unitId
        ? { ...u, unit_items: u.unit_items.filter(i => i.id !== itemId) }
        : u)
    setLevels(p => p.map(l => ({ ...l, course_units: removeItem(l.course_units) })))
    setFlatUnits(removeItem)
  }

  // ── Render Helpers ────────────────────────────────────────────────────────

  function renderItem(item: UnitItem, unitId: string) {
    return (
      <div key={item.id} className="flex items-center gap-3 py-2 px-3 rounded-lg bg-slate-800/60 border border-slate-700/50 group">
        <span className="text-xs px-2 py-0.5 rounded bg-slate-700 text-slate-300">{item.type}</span>
        <span className="text-slate-300 text-sm flex-1 truncate">{item.title}</span>
        <button onClick={() => deleteItem(item.id, unitId)} className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-500 hover:text-red-400 p-1">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    )
  }

  function renderUnit(unit: CourseUnit, levelId: string | null) {
    const isOpen = expanded[unit.id]
    return (
      <div key={unit.id} className="bg-slate-800/40 border border-slate-700/60 rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 p-3 cursor-pointer select-none" onClick={() => toggle(unit.id)}>
          {isOpen ? <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />}
          <BookOpen className="w-4 h-4 text-blue-400 shrink-0" />
          <span className="text-white text-sm font-medium flex-1">{unit.title}</span>
          <span className="text-slate-500 text-xs">{unit.unit_items.length} items</span>
          <button onClick={e => { e.stopPropagation(); setItemModal({ open: true, unitId: unit.id }) }} className="ml-1 p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors" title="Add content">
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button onClick={e => { e.stopPropagation(); deleteUnit(unit.id, levelId) }} className="p-1 rounded hover:bg-red-500/10 text-slate-500 hover:text-red-400 transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
        {isOpen && (
          <div className="px-3 pb-3 space-y-1.5 border-t border-slate-700/50 pt-2">
            {unit.unit_items.length === 0
              ? <p className="text-slate-500 text-xs py-2 text-center">No content yet — add items above</p>
              : unit.unit_items.map(item => renderItem(item, unit.id))
            }
          </div>
        )}
      </div>
    )
  }

  // ── Main Render ───────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.push('/teacher/courses')} className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold text-white truncate">{course.title}</h2>
          <p className="text-slate-400 text-sm">
            {course.has_levels ? 'Leveled course' : 'Flat course'} · {course.language ?? 'No language set'}
          </p>
        </div>
        <Badge variant={course.is_published ? 'green' : 'yellow'}>
          {course.is_published ? 'Published' : 'Draft'}
        </Badge>
      </div>

      {/* Leveled Course */}
      {course.has_levels ? (
        <div className="space-y-4">
          {levels.map(level => (
            <div key={level.id} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div
                className="flex items-center gap-3 p-4 cursor-pointer select-none hover:bg-slate-800/40 transition-colors"
                onClick={() => toggle(level.id)}
              >
                {expanded[level.id] ? <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />}
                <Layers className="w-4 h-4 text-violet-400 shrink-0" />
                <span className="text-white font-semibold flex-1">{level.title}</span>
                <span className="text-slate-500 text-sm">{level.course_units.length} units</span>
                <button
                  onClick={e => { e.stopPropagation(); setUnitModal({ open: true, levelId: level.id }) }}
                  className="ml-2 flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 px-2 py-1 rounded hover:bg-blue-500/10 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> Unit
                </button>
                <button onClick={e => { e.stopPropagation(); deleteLevel(level.id) }} className="p-1 rounded hover:bg-red-500/10 text-slate-500 hover:text-red-400 transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              {expanded[level.id] && (
                <div className="px-4 pb-4 space-y-2 border-t border-slate-800">
                  <div className="pt-3 space-y-2">
                    {level.course_units.length === 0
                      ? <p className="text-slate-500 text-sm text-center py-4">No units yet — add a unit above</p>
                      : level.course_units.map(unit => renderUnit(unit, level.id))
                    }
                  </div>
                </div>
              )}
            </div>
          ))}

          <Button variant="secondary" onClick={() => setLevelModal(true)}>
            <Plus className="w-4 h-4" /> Add Level
          </Button>
        </div>
      ) : (
        /* Flat Course */
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Units</h3>
            <Button size="sm" onClick={() => setUnitModal({ open: true, levelId: null })}>
              <Plus className="w-3.5 h-3.5" /> Add Unit
            </Button>
          </div>
          {flatUnits.length === 0
            ? (
              <div className="text-center py-12 bg-slate-900 border border-slate-800 rounded-xl">
                <BookOpen className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                <p className="text-slate-400">No units yet.</p>
                <p className="text-slate-500 text-sm">Add your first unit to start building this course.</p>
              </div>
            )
            : flatUnits.map(unit => renderUnit(unit, null))
          }
        </div>
      )}

      {/* ── Modals ─────────────────────────────────────────────────────────── */}

      {/* Add Level */}
      <Modal open={levelModal} onClose={() => setLevelModal(false)} title="Add Level">
        <form onSubmit={addLevel} className="space-y-4">
          <Input
            label="Level Title"
            value={levelForm.title}
            onChange={e => setLevelForm({ title: e.target.value })}
            required
            placeholder="e.g. Level 1 – Foundations, Month 1..."
          />
          <div className="flex gap-3">
            <Button type="button" variant="secondary" onClick={() => setLevelModal(false)} className="flex-1">Cancel</Button>
            <Button type="submit" loading={saving} className="flex-1">Add Level</Button>
          </div>
        </form>
      </Modal>

      {/* Add Unit */}
      <Modal open={unitModal.open} onClose={() => setUnitModal({ open: false, levelId: null })} title="Add Unit">
        <form onSubmit={addUnit} className="space-y-4">
          <Input
            label="Unit Title"
            value={unitForm.title}
            onChange={e => setUnitForm({ title: e.target.value })}
            required
            placeholder="e.g. Unit 1 – Daily Routines, Introduction..."
          />
          <div className="flex gap-3">
            <Button type="button" variant="secondary" onClick={() => setUnitModal({ open: false, levelId: null })} className="flex-1">Cancel</Button>
            <Button type="submit" loading={saving} className="flex-1">Add Unit</Button>
          </div>
        </form>
      </Modal>

      {/* Add Content Item */}
      <Modal open={itemModal.open} onClose={() => setItemModal({ open: false, unitId: null })} title="Add Content" size="xl">
        <form onSubmit={addItem} className="space-y-4">
          {/* AI Generator — strictly from the course's uploaded file */}
          <div className="bg-violet-500/10 border border-violet-500/20 rounded-xl p-3 space-y-2">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-4 h-4 text-violet-400" />
              <span className="text-violet-300 text-sm font-medium">توليد المحتوى من ملف الكورس</span>
            </div>
            <p className="text-slate-400 text-xs">
              اكتب عنوان القسم في خانة Title بالأسفل، ثم اضغط توليد — سيُكتب المحتوى من ملفك المرفوع فقط، بلا أي معلومات خارجية.
            </p>
            <Button type="button" onClick={generateItemContent} loading={aiLoading} variant="secondary" size="sm">
              <Sparkles className="w-4 h-4" /> توليد من ملف الكورس
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Title"
              value={itemForm.title}
              onChange={e => setItemForm(p => ({ ...p, title: e.target.value }))}
              required
              placeholder="Content title..."
            />
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-300">Type</label>
              <select
                value={itemForm.type}
                onChange={e => setItemForm(p => ({ ...p, type: e.target.value }))}
                className="w-full px-3 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {ITEM_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-300">Content (Markdown supported)</label>
            <textarea
              value={itemForm.body}
              onChange={e => setItemForm(p => ({ ...p, body: e.target.value }))}
              rows={10}
              required
              className="w-full px-3 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none font-mono"
              placeholder="Write or generate content above..."
            />
          </div>

          <div className="flex gap-3">
            <Button type="button" variant="secondary" onClick={() => setItemModal({ open: false, unitId: null })} className="flex-1">Cancel</Button>
            <Button type="submit" loading={saving} className="flex-1">Add Content</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
