'use client'

import Link from 'next/link'
import { useLang, PublicNav, PublicFooter } from './shell'
import { useTranslations } from 'next-intl'
import type enPublic from '@/messages/en/public.json'
import { localizedPath } from '@/i18n/public-routes'
import { FEATURE_ANCHORS, ROLE_ANCHORS, ROLES_SECTION, roleAnchorId } from './anchors'

// Copy lives in src/messages/<locale>/public.json. Read with t.raw(): it is
// structured (lists of cards, FAQs) and static, so there is nothing to format.
type FeaturesCopy = typeof enPublic.featuresPage

// The public pages carry no icons by design: text only, plain punctuation
// (no dashes or commas in the copy, see src/messages/<locale>/public.json).

export function FeaturesPage() {
  const [lang, setLang] = useLang()
  const t = useTranslations('public').raw('featuresPage') as FeaturesCopy

  return (
    <div className="min-h-screen bg-slate-950">
      <PublicNav lang={lang} setLang={setLang} />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-14">
        <h1 className="text-3xl sm:text-4xl font-bold text-white text-center">{t.title}</h1>
        <p className="text-slate-400 text-center max-w-2xl mx-auto mt-3 mb-12">{t.desc}</p>

        {/* Features */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {t.features.map((f, i) => (
            <div key={i} id={FEATURE_ANCHORS[i]} className="scroll-mt-24 bg-slate-900 border border-slate-800 rounded-xl p-6 hover:border-slate-700 transition-colors">
              <h3 className="text-white font-semibold mb-2">{f.title}</h3>
              <p className="text-slate-400 text-sm leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>

        {/* Roles */}
        <h2 id={ROLES_SECTION} className="scroll-mt-24 text-2xl sm:text-3xl font-bold text-white text-center mt-20 mb-3">{t.rolesTitle}</h2>
        <p className="text-slate-400 text-center max-w-2xl mx-auto mb-10">{t.rolesDesc}</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {t.roles.map((r, i) => (
            <div key={i} id={roleAnchorId(ROLE_ANCHORS[i])} className="scroll-mt-24 bg-slate-900 border border-slate-800 rounded-xl p-7">
              <h3 className="text-white font-semibold text-lg mb-4">{r.title}</h3>
              <ul className="space-y-2.5">
                {r.points.map((p, j) => (
                  <li key={j} className="text-slate-400 text-sm leading-relaxed">{p}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* How it works */}
        <h2 className="text-2xl sm:text-3xl font-bold text-white text-center mt-20 mb-10">{t.howTitle}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-4xl mx-auto">
          {t.steps.map((s) => (
            <div key={s.n} className="bg-slate-900 border border-slate-800 rounded-xl p-6">
              <span className="inline-flex w-9 h-9 rounded-full bg-blue-600 text-white font-bold items-center justify-center mb-4">{s.n}</span>
              <h3 className="text-white font-semibold mb-2">{s.title}</h3>
              <p className="text-slate-400 text-sm leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>

        <div className="text-center mt-14">
          <Link href={localizedPath(lang, '/contact')}
            className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors">
            {t.cta}
          </Link>
        </div>
      </main>

      <PublicFooter lang={lang} />
    </div>
  )
}
