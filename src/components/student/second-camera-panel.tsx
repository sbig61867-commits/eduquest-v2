'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Smartphone, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'

// Optional second camera: the student scans this QR with their phone, which
// then watches the desk and the screen from the side (src/app/cam/[token]).
// The link is signed for this attempt only and generated on demand.
export function SecondCameraPanel({ examId }: { examId: string }) {
  const t = useTranslations('student.secondCamera')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [qr, setQr] = useState<string | null>(null)
  const [link, setLink] = useState('')

  async function generate() {
    setLoading(true); setFailed(false)
    try {
      const res = await fetch('/api/proctor/second-camera', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ examId }),
      })
      if (!res.ok) throw new Error(String(res.status))
      const { path } = await res.json() as { path: string }
      const url = `${window.location.origin}${path}`
      const QRCode = (await import('qrcode')).default
      setQr(await QRCode.toDataURL(url, { margin: 1, width: 240, errorCorrectionLevel: 'M' }))
      setLink(url)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  function toggle() {
    const next = !open
    setOpen(next)
    if (next && !qr && !loading) generate()
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl">
      <button onClick={toggle} className="w-full flex items-center gap-2 px-4 py-3 text-start">
        <Smartphone className="w-4 h-4 text-blue-400 shrink-0" />
        <span className="flex-1 text-slate-200 text-sm font-medium">{t('panelTitle')}</span>
        {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
      </button>
      {open && (
        <div className="px-4 pb-4 flex flex-col sm:flex-row items-center gap-4">
          <div className="w-[160px] h-[160px] shrink-0 rounded-lg bg-white flex items-center justify-center">
            {loading && <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />}
            {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL generated in the browser; next/image has nothing to optimise */}
            {qr && !loading && <img src={qr} alt={t('qrAlt')} width={160} height={160} className="rounded-lg" />}
          </div>
          <div className="space-y-2 text-sm min-w-0">
            <p className="text-slate-300">{t('panelHint')}</p>
            {failed && (
              <p className="text-red-400">
                {t('failed')}{' '}
                <button onClick={generate} className="underline">{t('retry')}</button>
              </p>
            )}
            {link && <p className="text-slate-500 text-xs break-all" dir="ltr">{link}</p>}
          </div>
        </div>
      )}
    </div>
  )
}
