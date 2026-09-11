'use client'

import { useLang, PublicNav, PublicFooter } from './shell'
import { ContactForm } from './contact-form'

const dict = {
  ar: {
    title: 'تواصل معنا',
    desc: 'اترك رسالتك وسنرد عليك على بريدك في أقرب وقت — سواء كنت جامعة تريد الاشتراك أو لديك أي استفسار.',
  },
  en: {
    title: 'Contact Us',
    desc: 'Leave your message and we’ll reply to your email as soon as possible — whether you’re a university looking to subscribe or you have any question.',
  },
}

export function ContactPage() {
  const [lang, setLang] = useLang()
  const t = dict[lang]

  return (
    <div dir={lang === 'ar' ? 'rtl' : 'ltr'} className="min-h-screen bg-slate-950 flex flex-col">
      <PublicNav lang={lang} setLang={setLang} />
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-14">
        <h1 className="text-3xl sm:text-4xl font-bold text-white text-center">{t.title}</h1>
        <p className="text-slate-400 text-center max-w-xl mx-auto mt-3 mb-10">{t.desc}</p>
        <ContactForm lang={lang} />
      </main>
      <PublicFooter lang={lang} />
    </div>
  )
}
