'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Layers, Search } from 'lucide-react'
import type { GroupCard } from '@/lib/teacher-records'
import { Badge, ProgressBar, selectClass } from '@/components/teacher/records/ui'

type Sort = 'newest' | 'name' | 'avg'

export function GroupsClient({ cards }: { cards: GroupCard[] }) {
  const t = useTranslations('teacher.records')
  const locale = useLocale()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('newest')

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = cards.filter(c => !q || c.group.name.toLowerCase().includes(q) || (c.group.courseTitle ?? '').toLowerCase().includes(q))
    if (sort === 'name') return [...list].sort((a, b) => a.group.name.localeCompare(b.group.name, locale))
    if (sort === 'avg') return [...list].sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1))
    return list // already newest first from the server
  }, [cards, query, sort, locale])

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">{t('title')}</h2>
        <p className="text-slate-400 mt-1">{t('subtitle')}</p>
      </div>

      {cards.length === 0 ? (
        <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl">
          <Layers className="w-12 h-12 text-slate-600 mx-auto mb-3" aria-hidden />
          <p className="text-slate-300">{t('index.empty')}</p>
          <p className="text-slate-500 text-sm mt-1">{t('index.emptyHint')}</p>
        </div>
      ) : (
        <>
          <div className="flex flex-col sm:flex-row gap-3">
            <label className="relative flex-1">
              <span className="sr-only">{t('index.search')}</span>
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={t('index.search')}
                className="w-full ps-9 pe-3 py-2.5 rounded-lg bg-slate-900 border border-slate-800 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
            <label className="sm:w-56">
              <span className="sr-only">{t('index.sort')}</span>
              <select value={sort} onChange={e => setSort(e.target.value as Sort)} className={selectClass}>
                <option value="newest">{t('index.sortNewest')}</option>
                <option value="name">{t('index.sortName')}</option>
                <option value="avg">{t('index.sortAvg')}</option>
              </select>
            </label>
          </div>

          {shown.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-12">{t('index.noMatches')}</p>
          ) : (
            <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {shown.map(c => (
                <li key={c.group.id}>
                  <Link
                    href={`/teacher/records/${c.group.id}`}
                    className="group flex flex-col h-full bg-slate-900 border border-slate-800 hover:border-slate-600 rounded-xl overflow-hidden transition-colors"
                  >
                    {c.group.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.group.imageUrl} alt="" className="h-28 w-full object-cover" />
                    )}
                    <div className="p-5 flex-1 flex flex-col gap-4">
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-white font-semibold text-lg leading-snug group-hover:text-blue-300 transition-colors">{c.group.name}</h3>
                          {!c.group.isActive && <Badge tone="muted">{t('index.inactive')}</Badge>}
                        </div>
                        {c.group.courseTitle && <p className="text-slate-400 text-sm mt-1">{t('index.course')} {c.group.courseTitle}</p>}
                        <p className="text-slate-500 text-xs mt-2">
                          {t('index.students', { count: c.students })} · {t('index.exams', { count: c.exams })} · {t('index.homework', { count: c.homework })}
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-slate-500 text-xs mb-1.5">{t('index.avg')}</p>
                          <ProgressBar pct={c.avg} />
                        </div>
                        <div>
                          <p className="text-slate-500 text-xs mb-1.5">{t('index.attendance')}</p>
                          <ProgressBar pct={c.attendanceRate} tone="emerald" />
                        </div>
                      </div>

                      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                        {c.atRisk > 0 ? <Badge tone="bad">{t('index.atRisk', { count: c.atRisk })}</Badge> : <span />}
                        <span className="text-blue-400 text-sm font-medium">{t('index.open')}</span>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
