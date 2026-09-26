'use client'

import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { Locale } from '@/i18n/config'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { formatDate } from '@/lib/utils'
import { Copy, Download, Mail, Users } from 'lucide-react'

interface InterestedStudent { id: string; full_name: string; email: string; at: string }

/** Quotes a CSV cell and neutralises spreadsheet formulas (=, +, -, @ …). */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return `"${safe.replace(/"/g, '""')}"`
}

/**
 * The students who pressed "I'm interested" on one announcement — the list a
 * centre manager needs to follow up registrations. Loaded on open from
 * /api/announcements/interested (same authorisation as editing the
 * announcement).
 */
export function InterestedList({ announcementId, title }: { announcementId: string; title: string }) {
  const t = useTranslations('staff.announcements.interest')
  const locale = useLocale() as Locale
  const [students, setStudents] = useState<InterestedStudent[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch(`/api/announcements/interested?id=${encodeURIComponent(announcementId)}`)
      .then(async res => {
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) setError(data.error ?? t('loadFailed'))
        else setStudents(data.students ?? [])
      })
      .catch(() => { if (!cancelled) setError(t('loadFailed')) })
    return () => { cancelled = true }
  }, [announcementId, t])

  function downloadCsv() {
    if (!students?.length) return
    const rows = [
      [t('colName'), t('colEmail'), t('colDate')].map(csvCell).join(','),
      ...students.map(s => [s.full_name, s.email, formatDate(s.at, locale)].map(csvCell).join(',')),
    ]
    // BOM so Excel opens Arabic names correctly.
    const blob = new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${title.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'announcement'}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  async function copyEmails() {
    const emails = (students ?? []).map(s => s.email).filter(Boolean).join(', ')
    try {
      await navigator.clipboard.writeText(emails)
      toast.success(t('copied'))
    } catch {
      toast.error(t('copyFailed'))
    }
  }

  if (error) return <p className="text-rose-400 text-sm">{error}</p>
  if (!students) return <p className="text-slate-400 text-sm">{t('loading')}</p>
  if (students.length === 0) {
    return (
      <div className="text-center py-8">
        <Users className="w-10 h-10 text-slate-600 mx-auto mb-2" />
        <p className="text-slate-400 text-sm">{t('empty')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-slate-300 text-sm">{t('count', { count: students.length })}</p>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="ghost" onClick={copyEmails}><Copy className="w-3.5 h-3.5" /> {t('copyEmails')}</Button>
          <Button size="sm" variant="ghost" onClick={downloadCsv}><Download className="w-3.5 h-3.5" /> {t('downloadCsv')}</Button>
        </div>
      </div>
      <div className="max-h-80 overflow-y-auto divide-y divide-slate-800 border border-slate-800 rounded-lg">
        {students.map(s => (
          <div key={s.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-white text-sm font-medium truncate">{s.full_name || s.email}</p>
              <a href={`mailto:${s.email}`} dir="ltr" className="text-slate-400 hover:text-blue-300 text-xs inline-flex items-center gap-1 truncate">
                <Mail className="w-3 h-3 shrink-0" /> {s.email}
              </a>
            </div>
            <span className="text-slate-500 text-xs shrink-0">{formatDate(s.at, locale)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
