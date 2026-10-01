'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'

/**
 * Previous / Next and "page X of Y" for a server-paginated list
 * (PERFORMANCE_CONTRACT.md P1). The page lives in the URL (?page=), so the
 * server renders exactly one page; every other query parameter (the search)
 * is kept. Plain links: no loading state, no animation.
 */
export function ListPagination({ page, pageCount }: { page: number; pageCount: number }) {
  const t = useTranslations('common.pagination')
  const pathname = usePathname()
  const params = useSearchParams()
  if (pageCount <= 1) return null

  const hrefFor = (target: number) => {
    const next = new URLSearchParams(params.toString())
    if (target <= 1) next.delete('page')
    else next.set('page', String(target))
    const qs = next.toString()
    return qs ? `${pathname}?${qs}` : pathname
  }

  const linkClass = 'px-3 py-1.5 rounded-lg border border-slate-800 text-sm text-slate-300 hover:bg-slate-800'
  const disabledClass = 'px-3 py-1.5 rounded-lg border border-slate-900 text-sm text-slate-600'

  return (
    <nav className="flex items-center justify-between gap-3" aria-label={t('pageOf', { page, pages: pageCount })}>
      {page > 1
        ? <Link href={hrefFor(page - 1)} className={linkClass}>{t('prev')}</Link>
        : <span className={disabledClass} aria-disabled="true">{t('prev')}</span>}
      <span className="text-sm text-slate-400">{t('pageOf', { page, pages: pageCount })}</span>
      {page < pageCount
        ? <Link href={hrefFor(page + 1)} className={linkClass}>{t('next')}</Link>
        : <span className={disabledClass} aria-disabled="true">{t('next')}</span>}
    </nav>
  )
}
