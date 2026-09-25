'use client'

import { useLang, PublicNav, PublicFooter } from './shell'
import { useTranslations } from 'next-intl'

type Section = { h: string; body: string[] }
type PolicyDict = { title: string; updated: string; sections: Section[] }

export function PolicyPage({ kind }: { kind: 'privacy' | 'terms' }) {
  const [lang, setLang] = useLang()
  const t = useTranslations('public.policy').raw(kind) as PolicyDict

  return (
    <div className="min-h-screen bg-slate-950">
      <PublicNav lang={lang} setLang={setLang} />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-14">
        <h1 className="text-3xl sm:text-4xl font-bold text-white">{t.title}</h1>
        <p className="text-slate-500 text-sm mt-2 mb-10">{t.updated}</p>
        <div className="space-y-8">
          {t.sections.map((s, i) => (
            <section key={i}>
              <h2 className="text-white font-semibold text-lg mb-3">{s.h}</h2>
              <ul className="space-y-2">
                {s.body.map((line, j) => (
                  <li key={j} className="text-slate-400 text-sm leading-relaxed">{line}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </main>
      <PublicFooter lang={lang} />
    </div>
  )
}
