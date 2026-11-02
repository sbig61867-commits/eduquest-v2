'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Search, UserPlus, UserMinus, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { SCHOOL_LIMITS, type SchoolGrade, type SchoolSection, type SchoolStage } from '@/lib/school-structure'
import { fieldClass, labelClass, sendSchool } from './school-ui'

interface PlacementRow { id: string; full_name: string; section_id: string | null }
interface PlacementPage { students: PlacementRow[]; total: number; page: number; pageCount: number }
type Filter = 'all' | 'unplaced' | 'section'

// Typing waits this long before asking the server (one request per pause, not per key).
const SEARCH_DELAY_MS = 300

/**
 * التسكين: one server page (50) of the school's students with each one's
 * section in the selected year; pick students (up to 100 at a time) and place
 * them in a section, or take them out of it. Nothing is preloaded: the list
 * is read from /api/school/placement on demand.
 */
export function PlacementPanel({ grades, stages, sections, sectionsYearId }: {
  grades: SchoolGrade[]
  stages: SchoolStage[]
  sections: SchoolSection[]
  sectionsYearId: string | null
}) {
  const t = useTranslations('admin.schoolClient')
  const router = useRouter()
  const active = useMemo(() => sections.filter(s => s.is_active), [sections])
  const [target, setTarget] = useState<string>('')
  const [filter, setFilter] = useState<Filter>('unplaced')
  const [query, setQuery] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<PlacementPage | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)

  const sectionName = useMemo(() => new Map(sections.map(s => [s.id, s.name])), [sections])
  const targetSection = active.find(s => s.id === target) ?? null

  useEffect(() => {
    const timer = setTimeout(() => { setQ(query.trim()); setPage(1) }, SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [query])

  // One read per change of year / page / search / filter / target (and after a
  // placement); a newer read supersedes an older one still in flight.
  const [reloads, setReloads] = useState(0)
  useEffect(() => {
    if (!sectionsYearId || (filter === 'section' && !target)) return
    const mine = ++seq.current
    const params = new URLSearchParams({ year_id: sectionsYearId, page: String(page) })
    if (q) params.set('q', q)
    if (filter === 'unplaced') params.set('unplaced', '1')
    if (filter === 'section') params.set('section_id', target)
    sendSchool<PlacementPage>(`/api/school/placement?${params}`, 'GET').then(
      next => { if (mine === seq.current) setData(next) },
      (e: Error) => { if (mine === seq.current) toast(e.message || t('requestFailed'), 'error') },
    )
  }, [sectionsYearId, page, q, filter, target, t, reloads])

  if (!sectionsYearId) {
    return <div className="bg-surface border border-line rounded-overlay p-6 text-center text-fg-2 text-body-sm">{t('noYearForPlacement')}</div>
  }

  const rows = data?.students ?? []
  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else if (next.size < SCHOOL_LIMITS.placementBatch) next.add(id)
    return next
  })
  const allOnPage = rows.length > 0 && rows.every(r => selected.has(r.id))
  const togglePage = () => setSelected(prev => {
    const next = new Set(prev)
    if (allOnPage) rows.forEach(r => next.delete(r.id))
    else for (const r of rows) { if (next.size >= SCHOOL_LIMITS.placementBatch) break; next.add(r.id) }
    return next
  })

  async function apply(method: 'POST' | 'DELETE') {
    if (!target || selected.size === 0) return
    setBusy(true)
    try {
      const body = { section_id: target, student_ids: [...selected] }
      if (method === 'POST') {
        const r = await sendSchool<{ placed: number; moved: number }>('/api/school/placement', 'POST', body)
        toast(t('placedToast', { placed: r.placed, moved: r.moved }))
      } else {
        const r = await sendSchool<{ removed: number }>('/api/school/placement', 'DELETE', body)
        toast(t('removedToast', { removed: r.removed }))
      }
      setSelected(new Set())
      setReloads(n => n + 1)
      router.refresh() // member counts on the structure tab
    } catch (e) {
      toast((e as Error).message || t('requestFailed'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const stageName = (id: string) => stages.find(s => s.id === id)?.name ?? ''
  const gradesWithSections = grades.filter(g => active.some(s => s.grade_id === g.id))

  return (
    <div className="space-y-4">
      <div className="bg-surface border border-line rounded-overlay p-4 grid gap-3 md:grid-cols-3">
        <label className="block">
          <span className={labelClass}>{t('targetSection')}</span>
          <select className={fieldClass} value={target} onChange={e => { setTarget(e.target.value); if (filter === 'section') setPage(1) }}>
            <option value="">{t('chooseSection')}</option>
            {gradesWithSections.map(g => (
              <optgroup key={g.id} label={`${stageName(g.stage_id)} · ${g.name}`}>
                {active.filter(s => s.grade_id === g.id).map(s => (
                  <option key={s.id} value={s.id}>
                    {s.capacity ? t('sectionOption', { name: s.name, members: s.members, capacity: s.capacity }) : s.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>{t('filter')}</span>
          <select className={fieldClass} value={filter} onChange={e => { setFilter(e.target.value as Filter); setPage(1) }}>
            <option value="unplaced">{t('filterUnplaced')}</option>
            <option value="all">{t('filterAll')}</option>
            <option value="section" disabled={!target}>{t('filterSection')}</option>
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>{t('search')}</span>
          <span className="relative block">
            <Search className="w-4 h-4 text-fg-3 absolute top-1/2 -translate-y-1/2 start-3" aria-hidden="true" />
            <input className={`${fieldClass} ps-9`} value={query} onChange={e => setQuery(e.target.value)} placeholder={t('searchHint')} />
          </span>
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body-sm text-fg-2">{t('selectedCount', { count: selected.size, max: SCHOOL_LIMITS.placementBatch })}</p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={!targetSection || selected.size === 0} loading={busy} onClick={() => apply('POST')}>
            <UserPlus className="w-4 h-4" /> {t('placeSelected')}
          </Button>
          <Button variant="secondary" disabled={!targetSection || selected.size === 0 || busy} onClick={() => apply('DELETE')}>
            <UserMinus className="w-4 h-4" /> {t('removeSelected')}
          </Button>
        </div>
      </div>

      <div className="bg-surface border border-line rounded-overlay overflow-x-auto">
        <table className="w-full text-body-sm">
          <thead className="text-start text-label text-fg-3 border-b border-line">
            <tr>
              <th className="p-3 w-10">
                <input type="checkbox" aria-label={t('selectPage')} checked={allOnPage} onChange={togglePage} />
              </th>
              <th className="p-3 text-start font-medium">{t('studentColumn')}</th>
              <th className="p-3 text-start font-medium">{t('sectionColumn')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data && rows.length === 0 ? (
              <tr><td colSpan={3} className="p-6 text-center text-fg-3">{t('noStudents')}</td></tr>
            ) : rows.map(r => (
              <tr key={r.id} className="hover:bg-elevated">
                <td className="p-3">
                  <input type="checkbox" aria-label={r.full_name} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                </td>
                <td className="p-3 text-fg">{r.full_name}</td>
                <td className="p-3 text-fg-2">{r.section_id ? (sectionName.get(r.section_id) ?? t('otherSection')) : t('notPlaced')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data && data.pageCount > 1 && (
        <div className="flex items-center justify-center gap-3 text-body-sm text-fg-2">
          <Button variant="ghost" size="sm" disabled={data.page <= 1} onClick={() => setPage(data.page - 1)} aria-label={t('previous')}>
            <ChevronRight className="w-4 h-4 ltr:rotate-180" />
          </Button>
          <span>{t('pageOf', { page: data.page, pages: data.pageCount, total: data.total })}</span>
          <Button variant="ghost" size="sm" disabled={data.page >= data.pageCount} onClick={() => setPage(data.page + 1)} aria-label={t('next')}>
            <ChevronLeft className="w-4 h-4 ltr:rotate-180" />
          </Button>
        </div>
      )}
    </div>
  )
}
