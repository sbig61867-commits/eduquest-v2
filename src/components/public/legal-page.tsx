'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useLang, PublicNav, PublicFooter } from './shell'
import { CheckDot } from './ui'
import { COOKIE_ROWS } from './policy'
import { localizedPath } from '@/i18n/public-routes'
import type { Locale } from '@/i18n/config'

// Legal centre (/legal): the policy documents as an asymmetric grid of tiles,
// each with its own preview (key points, section list, the security note, the
// cookie names). Each tile opens its document in the policy centre
// (src/components/public/policy.tsx), which selects the tab from the path or
// the #security / #cookies hash. One column on small screens, in DOM order.

type DocKey = 'terms' | 'privacy' | 'security' | 'cookies'
type Doc = { title: string; updated: string; keyPoints: string[]; sections: { h: string }[] }

const GROUP: Record<DocKey, 'general' | 'securityGroup'> = {
  privacy: 'general', terms: 'general', security: 'securityGroup', cookies: 'securityGroup',
}

// Grid placement on md and up (6 columns): privacy large, terms tall, the two
// security documents small beneath privacy.
const PLACE: Record<DocKey, string> = {
  privacy: 'md:col-span-4 md:row-span-2',
  terms: 'md:col-span-2 md:row-span-3',
  security: 'md:col-span-2',
  cookies: 'md:col-span-2',
}

const ORDER: DocKey[] = ['privacy', 'terms', 'security', 'cookies']

function docHref(lang: Locale, doc: DocKey): string {
  if (doc === 'terms') return localizedPath(lang, '/terms')
  if (doc === 'privacy') return localizedPath(lang, '/privacy')
  return `${localizedPath(lang, '/privacy')}#${doc}`
}

export function LegalPage() {
  const [lang, setLang] = useLang()
  const t = useTranslations('public.legal')
  const p = useTranslations('public.policy')
  const badges = p.raw('badges') as Record<DocKey, string>
  const note = p.raw('securityNote') as { title: string; body: string }
  const docs = Object.fromEntries(ORDER.map(k => [k, p.raw(k) as Doc])) as Record<DocKey, Doc>

  const preview = (doc: DocKey) => {
    if (doc === 'privacy') {
      return (
        <ul className="mt-6 grid sm:grid-cols-3 gap-4">
          {docs.privacy.keyPoints.slice(0, 3).map(k => (
            <li key={k} className="flex gap-3 text-fg-2 text-sm leading-relaxed border-t border-line pt-4"><CheckDot tone="bg-accent" />{k}</li>
          ))}
        </ul>
      )
    }
    if (doc === 'terms') {
      return (
        <ol className="mt-6 border-s border-line">
          {docs.terms.sections.map(s => (
            <li key={s.h} className="ps-4 py-1.5 text-fg-2 text-sm">{s.h}</li>
          ))}
        </ol>
      )
    }
    if (doc === 'security') {
      return (
        <div role="note" className="mt-4 border-s-2 border-accent ps-4">
          <p className="text-fg text-sm font-semibold">{note.title}</p>
          <p className="text-fg-2 text-sm mt-1 leading-relaxed">{note.body}</p>
        </div>
      )
    }
    return (
      <div className="mt-4 flex items-start gap-4">
        <span className="text-accent text-3xl font-bold leading-none">{COOKIE_ROWS.length}</span>
        <ul className="flex flex-wrap gap-2">
          {COOKIE_ROWS.map(r => (
            <li key={r.key} dir="ltr" className="rounded-full border border-line px-2 py-0.5 text-fg-3 text-xs">{r.name}</li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-canvas text-fg overflow-x-clip">
      <PublicNav lang={lang} setLang={setLang} />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-14">
        <p className="text-accent text-sm font-semibold mb-3">{t('eyebrow')}</p>
        <h1 className="text-3xl sm:text-4xl font-bold text-fg">{t('title')}</h1>
        <p className="text-fg-2 mt-3 max-w-3xl leading-relaxed">{t('desc')}</p>

        <ul className="mt-10 grid grid-cols-1 md:grid-cols-6 gap-4">
          {ORDER.map(doc => {
            const large = doc === 'privacy'
            return (
              <li key={doc} className={`min-w-0 ${PLACE[doc]}`}>
                <Link
                  href={docHref(lang, doc)}
                  className={`group flex h-full flex-col rounded-lg border border-line transition-colors hover:border-line-strong ${large ? 'bg-surface p-6' : 'bg-canvas p-4 sm:p-6'}`}
                >
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-accent text-xs font-semibold">{t(GROUP[doc])}</span>
                    <span dir="ltr" className="rounded-full border border-line px-3 py-0.5 text-fg-3 text-xs font-semibold">{badges[doc]}</span>
                  </span>
                  <span className={`block mt-4 text-fg font-bold ${large ? 'text-2xl' : 'text-lg'}`}>{docs[doc].title}</span>
                  <span className="block mt-2 text-fg-2 text-sm leading-relaxed">{t(`docs.${doc}`)}</span>
                  {preview(doc)}
                  <span className="mt-auto pt-6 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-fg-3 text-xs">{docs[doc].updated}</span>
                    <span className="text-accent group-hover:text-accent-hover text-sm font-semibold">{t('open')}</span>
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      </main>
      <PublicFooter lang={lang} />
    </div>
  )
}
