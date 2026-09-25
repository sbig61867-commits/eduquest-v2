'use client'

import { useLang, PublicNav, PublicFooter } from './shell'
import { useTranslations } from 'next-intl'
import { ContactForm } from './contact-form'

export function ContactPage() {
  const [lang, setLang] = useLang()
  const t = useTranslations('public.contact')

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      <PublicNav lang={lang} setLang={setLang} />
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-14">
        <h1 className="text-3xl sm:text-4xl font-bold text-white text-center">{t('title')}</h1>
        <p className="text-slate-400 text-center max-w-xl mx-auto mt-3 mb-10">{t('desc')}</p>
        <ContactForm />
      </main>
      <PublicFooter lang={lang} />
    </div>
  )
}
