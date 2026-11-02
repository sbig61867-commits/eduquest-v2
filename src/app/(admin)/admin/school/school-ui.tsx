import type { SubjectColour } from '@/lib/school-timetable'

// Small shared pieces of /admin/school: the JSON call to /api/school/* and the
// token-only field / tag styles (design-tokens.css; no palette colours).

export async function sendSchool<T = Record<string, unknown>>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? '')
  return data as T
}

export const fieldClass =
  'w-full px-3 py-2 rounded-control bg-surface border border-line text-fg text-body-sm placeholder:text-fg-3 eq-focus'
export const labelClass = 'block text-label text-fg-2 mb-1.5'

export function tag(text: string, tone: 'neutral' | 'success' = 'neutral') {
  return (
    <span className={tone === 'success'
      ? 'inline-flex items-center px-2 py-0.5 rounded-control text-label bg-success-subtle text-success'
      : 'inline-flex items-center px-2 py-0.5 rounded-control text-label bg-elevated text-fg-2 border border-line'}>
      {text}
    </span>
  )
}

/** A subject's colour NAME → token classes (the only colours a subject can have). */
const SUBJECT_TONES: Record<SubjectColour, string> = {
  neutral: 'bg-elevated text-fg-2 border-line',
  accent: 'bg-accent-subtle text-accent border-accent',
  info: 'bg-info-subtle text-info border-info',
  success: 'bg-success-subtle text-success border-success',
  warning: 'bg-warning-subtle text-warning border-warning',
  danger: 'bg-danger-subtle text-danger border-danger',
}

export const subjectTone = (colour: SubjectColour | null | undefined) => SUBJECT_TONES[colour ?? 'neutral']
