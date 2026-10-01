'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Search } from 'lucide-react'

export interface PickedTeacher { id: string; full_name: string }

// Typing waits this long before asking the server (one request per pause, not per key).
const SEARCH_DELAY_MS = 300

/**
 * Teacher selector for /center/groups and /center/courses: nothing is listed
 * until the user types, then ONE search per pause goes to /api/teachers/search
 * (≤ 20 active teachers, id + name). The institution's teaching staff never
 * reaches the page. `scope` is the screen assigning the teacher — the server
 * checks the matching capability (manage_groups / manage_courses).
 */
export function TeacherPicker({ scope, selectedId, onPick }: {
  scope: 'groups' | 'courses'
  /** Highlights the teacher already chosen, if they appear in the results. */
  selectedId?: string | null
  onPick: (teacher: PickedTeacher) => void
}) {
  const t = useTranslations('staff.teacherPicker')
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<PickedTeacher[] | null>(null)
  const seq = useRef(0)

  useEffect(() => {
    const q = query.trim()
    const mine = ++seq.current
    if (!q) return
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/teachers/search?for=${scope}&q=${encodeURIComponent(q)}`)
      const json = await res.json().catch(() => ({}))
      if (mine !== seq.current) return // a newer search superseded this one
      setFound(res.ok ? (json.teachers ?? []) : [])
    }, SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [query, scope])

  // Nothing typed ⇒ no results shown, whatever an older search returned.
  const results = query.trim() ? found : null

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('search')}
          className="w-full ps-10 pe-4 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
        />
      </div>
      {results === null ? (
        <p className="text-slate-500 text-sm py-1">{t('typeToSearch')}</p>
      ) : results.length === 0 ? (
        <p className="text-slate-500 text-sm py-1">{t('noResults')}</p>
      ) : (
        <div className="max-h-56 overflow-y-auto border border-slate-800 rounded-lg divide-y divide-slate-800">
          {results.map(teacher => (
            <button
              key={teacher.id}
              type="button"
              onClick={() => onPick(teacher)}
              aria-pressed={teacher.id === selectedId}
              className={`w-full text-start px-3 py-2 text-sm hover:bg-slate-800 ${teacher.id === selectedId ? 'text-blue-400' : 'text-white'}`}
            >
              {teacher.full_name || '—'}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
