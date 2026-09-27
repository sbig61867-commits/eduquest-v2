'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Camera, CheckCircle2, AlertTriangle, Smartphone } from 'lucide-react'
import { useObjectDetection } from '@/hooks/use-object-detection'

// The phone side of the second camera (src/lib/second-camera-token.ts).
// Rear camera, pointed at the student, the desk and the screen from the side.
// Detection runs HERE on the phone (phone / book / another person); only an
// event line and, for a detection, one small snapshot go to the server. No
// video is sent or stored. The screen is kept awake while the page is open.

const SIDE_OBJECTS = ['cell phone', 'book'] as const
const COOLDOWN_MS = 20_000
const SNAP_W = 320
const SNAP_H = 240

type State = 'idle' | 'starting' | 'active' | 'error' | 'ended'

export function CamClient({ token }: { token: string }) {
  const t = useTranslations('student.secondCamera')
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const lastRef = useRef<Record<string, number>>({})
  const [state, setState] = useState<State>('idle')
  const [detections, setDetections] = useState(0)

  const send = useCallback(async (body: Record<string, unknown>) => {
    try {
      const res = await fetch('/api/proctor/second-camera/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, ...body }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 401 || data.reason === 'not_in_progress') {
        streamRef.current?.getTracks().forEach(tr => tr.stop())
        setState('ended')
      }
    } catch { /* network blip: the next detection tries again */ }
  }, [token])

  const snapshot = useCallback((): string | undefined => {
    const video = videoRef.current
    if (!video || video.readyState < 2) return undefined
    const canvas = document.createElement('canvas')
    canvas.width = SNAP_W; canvas.height = SNAP_H
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined
    ctx.drawImage(video, 0, 0, SNAP_W, SNAP_H)
    let url = canvas.toDataURL('image/webp', 0.5)
    if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/jpeg', 0.55)
    return url.split(',')[1]
  }, [])

  const onViolation = useCallback((type: string, details?: string) => {
    if (type !== 'suspicious_activity' && type !== 'multiple_faces') return
    const now = Date.now()
    if (now - (lastRef.current[type] ?? 0) < COOLDOWN_MS) return
    lastRef.current[type] = now
    setDetections(n => n + 1)
    send({ kind: 'violation', type, details, imageBase64: snapshot() })
  }, [send, snapshot])

  useObjectDetection(videoRef, state === 'active', onViolation, undefined, SIDE_OBJECTS)

  async function start() {
    setState('starting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
      }
      setState('active')
      send({ kind: 'connected' })
    } catch {
      setState('error')
    }
  }

  // Keep the phone awake while the camera runs (released on leave).
  useEffect(() => {
    if (state !== 'active') return
    let lock: { release: () => Promise<void> } | null = null
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }
    nav.wakeLock?.request('screen').then(l => { lock = l }).catch(() => {})
    return () => { lock?.release().catch(() => {}) }
  }, [state])

  useEffect(() => () => { streamRef.current?.getTracks().forEach(tr => tr.stop()) }, [])

  return (
    <main className="min-h-screen bg-slate-950 text-white p-4 flex flex-col gap-4 max-w-md mx-auto">
      <header className="flex items-center gap-2 pt-2">
        <Smartphone className="w-5 h-5 text-blue-400" />
        <h1 className="text-lg font-bold">{t('phoneTitle')}</h1>
      </header>

      <div className="relative rounded-xl overflow-hidden bg-black aspect-[4/3] border border-slate-800">
        <video ref={videoRef} muted playsInline autoPlay className="w-full h-full object-cover" />
        {state !== 'active' && (
          <div className="absolute inset-0 flex items-center justify-center text-slate-600"><Camera className="w-10 h-10" /></div>
        )}
      </div>

      {state === 'idle' || state === 'starting' ? (
        <>
          <ul className="text-sm text-slate-300 space-y-1.5 list-disc ps-5">
            <li>{t('stepPlace')}</li>
            <li>{t('stepCharge')}</li>
            <li>{t('stepKeepOpen')}</li>
          </ul>
          <button onClick={start} disabled={state === 'starting'}
            className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 font-semibold">
            {t('startCamera')}
          </button>
        </>
      ) : state === 'active' ? (
        <div className="flex items-start gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 text-sm text-emerald-300">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          <p>{t('activeNote')}{detections > 0 ? ` ${t('detections', { count: detections })}` : ''}</p>
        </div>
      ) : state === 'ended' ? (
        <div className="flex items-start gap-2 bg-slate-800 border border-slate-700 rounded-xl p-3 text-sm text-slate-300">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /><p>{t('ended')}</p>
        </div>
      ) : (
        <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-sm text-red-300">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><p>{t('cameraError')}</p>
        </div>
      )}
    </main>
  )
}
