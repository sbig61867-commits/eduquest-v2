'use client'
import { confirmDialog } from '@/lib/confirm-dialog'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Archive, ArchiveRestore, Users, BookOpen, ClipboardList, GraduationCap, Search } from 'lucide-react'
import { toast } from '@/components/ui/toast'

export interface ArchiveRow {
  kind: 'group' | 'course'
  id: string
  title: string
  teacher_id: string | null
  teacher_name: string | null
  created_at: string
  deleted_at: string | null
  is_archived: boolean
  student_count: number
  lesson_count: number
  exam_count: number
  submission_count: number
}

export function ArchiveClient({ rows }: { rows: ArchiveRow[] }) {
  const router = useRouter()
  const [items, setItems] = useState(rows)
  const [year, setYear] = useState<string>('all')
  const [status, setStatus] = useState<'all' | 'archived' | 'live'>('all')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState('')

  const years = useMemo(() => {
    const s = new Set(items.map(r => new Date(r.created_at).getFullYear()))
    return [...s].sort((a, b) => b - a)
  }, [items])

  const filtered = items.filter(r => {
    if (year !== 'all' && new Date(r.created_at).getFullYear() !== Number(year)) return false
    if (status === 'archived' && !r.is_archived) return false
    if (status === 'live' && r.is_archived) return false
    if (q && !(`${r.title} ${r.teacher_name ?? ''}`.toLowerCase().includes(q.toLowerCase()))) return false
    return true
  })

  async function restore(r: ArchiveRow) {
    if (!(await confirmDialog(`Restore "${r.title}" from the archive? It will become visible on the platform again.`))) return
    setBusy(r.id)
    const res = await fetch('/api/admin/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: r.kind, id: r.id }),
    })
    if (res.ok) { setItems(prev => prev.map(x => x.id === r.id ? { ...x, is_archived: false, deleted_at: null } : x)); router.refresh() }
    else toast.error((await res.json().catch(() => ({}))).error ?? 'Failed to restore')
    setBusy('')
  }

  const archivedCount = items.filter(r => r.is_archived).length

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-fg">University Archive</h2>
        <p className="text-fg-secondary mt-1">
          Full historical record — {items.length} classes &amp; courses ({archivedCount} archived). All submissions and grades are preserved for future reference.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-muted" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name or teacher..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-surface border border-border-strong text-fg text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
        </div>
        <select value={year} onChange={e => setYear(e.target.value)}
          className="px-3 py-2 rounded-lg bg-surface border border-border-strong text-fg text-sm focus:outline-none focus:ring-2 focus:ring-accent">
          <option value="all">All years</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <div className="flex rounded-lg border border-border-strong overflow-hidden">
          {([['all', 'All'], ['live', 'Active'], ['archived', 'Archived']] as const).map(([v, label]) => (
            <button key={v} onClick={() => setStatus(v)}
              className={`px-3 py-2 text-sm transition-colors ${status === v ? 'bg-accent text-accent-fg' : 'bg-surface text-fg-secondary hover:text-fg'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 bg-surface border border-border rounded-lg">
          <Archive className="w-10 h-10 text-fg-muted mx-auto mb-3" />
          <p className="text-fg-secondary">No matching items.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map(r => (
            <div key={r.id} className={`bg-surface border rounded-lg p-4 ${r.is_archived ? 'border-amber-500/30' : 'border-border'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${r.kind === 'group' ? 'bg-accent-subtle text-accent' : 'bg-accent-subtle text-accent'}`}>
                    {r.kind === 'group' ? <Users className="w-4 h-4" /> : <BookOpen className="w-4 h-4" />}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-fg font-semibold truncate">{r.title}</h3>
                      <Badge variant={r.kind === 'group' ? 'info' : 'neutral'}>{r.kind === 'group' ? 'Class' : 'Course'}</Badge>
                      {r.is_archived
                        ? <Badge variant="warning">Archived</Badge>
                        : <Badge variant="success">Active</Badge>}
                    </div>
                    <p className="text-fg-muted text-xs mt-1 flex items-center gap-1.5 flex-wrap">
                      <GraduationCap className="w-3.5 h-3.5" /> {r.teacher_name ?? 'Unknown'}
                      <span className="mx-1">·</span>
                      Created {new Date(r.created_at).toLocaleDateString('en-GB')}
                      {r.deleted_at && <><span className="mx-1">·</span>Archived {new Date(r.deleted_at).toLocaleDateString('en-GB')}</>}
                    </p>
                    <div className="flex items-center gap-3 mt-2 text-xs text-fg-secondary">
                      <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{r.student_count} students</span>
                      {r.kind === 'group' && <span className="flex items-center gap-1"><BookOpen className="w-3.5 h-3.5" />{r.lesson_count} lessons</span>}
                      <span className="flex items-center gap-1"><ClipboardList className="w-3.5 h-3.5" />{r.exam_count} exams/homework</span>
                      <span className="text-accent">{r.submission_count} submissions</span>
                    </div>
                  </div>
                </div>
                {r.is_archived && (
                  <Button size="sm" variant="secondary" loading={busy === r.id} onClick={() => restore(r)}>
                    <ArchiveRestore className="w-3.5 h-3.5" /> Restore
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
