'use client'

import { useState } from 'react'
import { Mail } from 'lucide-react'
import type { Lang } from './shell'

const dict = {
  ar: {
    name: 'الاسم',
    email: 'بريدك الإلكتروني',
    message: 'رسالتك',
    messagePh: 'أخبرنا عن جامعتك وما تحتاجه...',
    send: 'إرسال الرسالة',
    sending: 'جارٍ الإرسال...',
    success: 'وصلتنا رسالتك! سنرد عليك على بريدك قريباً.',
    error: 'تعذر الإرسال، تأكد من الحقول وحاول مجدداً.',
    rateLimit: 'وصلت الحد الأقصى للرسائل، حاول لاحقاً.',
  },
  en: {
    name: 'Name',
    email: 'Your email',
    message: 'Your message',
    messagePh: 'Tell us about your university and what you need...',
    send: 'Send Message',
    sending: 'Sending...',
    success: 'Message received! We’ll reply to your email soon.',
    error: 'Could not send. Check the fields and try again.',
    rateLimit: 'Message limit reached. Please try again later.',
  },
}

export function ContactForm({ lang }: { lang: Lang }) {
  const t = dict[lang]
  const [form, setForm] = useState({ name: '', email: '', message: '' })
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [sendError, setSendError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSendError(''); setSending(true)
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (res.status === 429) setSendError(t.rateLimit)
      else if (!res.ok) setSendError(t.error)
      else {
        setSent(true)
        setForm({ name: '', email: '', message: '' })
      }
    } catch {
      setSendError(t.error)
    }
    setSending(false)
  }

  return (
    <form onSubmit={submit} className="max-w-xl mx-auto bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-4">
      {sent && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-4 py-3 text-emerald-400 text-sm font-medium">
          {t.success}
        </div>
      )}
      {sendError && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-red-400 text-sm font-medium">
          {sendError}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-300">{t.name}</label>
          <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
            required maxLength={100}
            className="w-full px-4 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:border-accent transition-colors" />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-300">{t.email}</label>
          <input type="email" dir="ltr" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
            required maxLength={200}
            className="w-full px-4 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:border-accent transition-colors" />
        </div>
      </div>
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-slate-300">{t.message}</label>
        <textarea value={form.message} onChange={e => setForm(p => ({ ...p, message: e.target.value }))}
          required maxLength={2000} rows={6} placeholder={t.messagePh}
          className="w-full px-4 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:border-accent transition-colors resize-y" />
      </div>
      <button type="submit" disabled={sending}
        className="w-full px-7 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white font-semibold transition-colors flex items-center justify-center gap-2">
        <Mail className="w-4 h-4" /> {sending ? t.sending : t.send}
      </button>
    </form>
  )
}
