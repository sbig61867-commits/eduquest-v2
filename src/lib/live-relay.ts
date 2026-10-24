// The relay rules of the per-exam live channel (step 13), as pure functions so
// they are tested on their own; the Durable Object (live/exam-live.ts) only
// moves the messages these functions decide. They carry over the old Supabase
// Realtime policies exactly (supabase/live_thumbnails_migration.sql):
//
//   exam-live:<exam>    teacher and in-progress students join; both announce
//                       presence; ONLY the teacher broadcasts (watch / clip /
//                       thumbs), and the students receive it.
//   exam-thumbs:<exam>  students send pictures; ONLY the teacher receives them.
//
// Two tightenings: presence goes to the teacher only (students never used it),
// and a picture's sender id is the verified one from the ticket, not whatever
// the page wrote — a student cannot post a picture as someone else.
//
// No '@/…' imports: worker.ts bundles this file too.

import type { LiveRole } from './live-ticket'

export interface Peer {
  userId: string
  role: LiveRole
  topic: string
  /** The last presence this peer announced (live topic only). */
  presence?: Record<string, number>
}

export type ServerMsg =
  | { t: 'presence'; event: 'sync'; state: Record<string, Record<string, number>[]> }
  | { t: 'presence'; event: 'join'; key: string }
  | { t: 'broadcast'; event: string; payload: unknown }

export interface Decision {
  /** The sender's new presence, when it changed. */
  presence?: Record<string, number>
  /** Who receives what. */
  deliveries: { to: Peer[]; msg: ServerMsg }[]
}

/** A message larger than this is dropped unread (a picture is ≤ 40 000 characters). */
export const MAX_MESSAGE_CHARS = 64_000
export const TEACHER_KEY = 'teacher'
const TEACHER_EVENTS = new Set(['watch', 'clip', 'thumbs'])
const PICTURE_RE = /^data:image\/(webp|jpeg);base64,[A-Za-z0-9+/=]+$/

export const isLive = (topic: string) => topic.startsWith('exam-live:')
export const isThumbs = (topic: string) => topic.startsWith('exam-thumbs:')
export const presenceKey = (p: Peer) => (p.role === 'teacher' ? TEACHER_KEY : p.userId)

/** The presence state the teacher's page reads: key → [announcement]. */
export function presenceState(peers: Peer[]): Record<string, Record<string, number>[]> {
  const state: Record<string, Record<string, number>[]> = {}
  for (const p of peers) if (isLive(p.topic) && p.presence) state[presenceKey(p)] = [p.presence]
  return state
}

const teachersOn = (peers: Peer[], topic: string) => peers.filter(p => p.role === 'teacher' && p.topic === topic)
const studentsOn = (peers: Peer[], topic: string) => peers.filter(p => p.role === 'student' && p.topic === topic)

/** Counts only: a student's presence keeps v and ev as numbers; the teacher's is empty. */
function cleanPresence(from: Peer, payload: unknown): Record<string, number> {
  if (from.role === 'teacher') return {}
  const p = (payload && typeof payload === 'object' ? payload : {}) as { v?: unknown; ev?: unknown }
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.min(Math.floor(x), 1_000_000) : 0)
  return { v: num(p.v), ev: num(p.ev) }
}

/**
 * What happens when `from` sends `raw`. `peers` are everyone connected to this
 * exam (both topics), `from` included, with their current presence.
 */
export function decide(from: Peer, raw: string, peers: Peer[]): Decision {
  const none: Decision = { deliveries: [] }
  if (raw.length > MAX_MESSAGE_CHARS) return none
  let msg: { t?: unknown; event?: unknown; payload?: unknown }
  try { msg = JSON.parse(raw) } catch { return none }
  if (!msg || typeof msg !== 'object') return none

  if (msg.t === 'track' && isLive(from.topic)) {
    const presence = cleanPresence(from, msg.payload)
    const first = !from.presence
    const after = peers.map(p => (p === from ? { ...p, presence } : p))
    const teachers = teachersOn(peers, from.topic)
    const deliveries: Decision['deliveries'] = [{ to: teachers, msg: { t: 'presence', event: 'sync', state: presenceState(after) } }]
    if (first) deliveries.push({ to: teachers.filter(t => t !== from), msg: { t: 'presence', event: 'join', key: presenceKey(from) } })
    return { presence, deliveries }
  }

  if (msg.t === 'broadcast' && typeof msg.event === 'string') {
    if (isLive(from.topic) && from.role === 'teacher' && TEACHER_EVENTS.has(msg.event)) {
      return { deliveries: [{ to: studentsOn(peers, from.topic), msg: { t: 'broadcast', event: msg.event, payload: msg.payload } }] }
    }
    if (isThumbs(from.topic) && from.role === 'student' && msg.event === 'thumb') {
      const img = (msg.payload as { img?: unknown } | null)?.img
      if (typeof img !== 'string' || img.length > 40_000 || !PICTURE_RE.test(img)) return none
      return { deliveries: [{ to: teachersOn(peers, from.topic), msg: { t: 'broadcast', event: 'thumb', payload: { id: from.userId, img, at: Date.now() } } }] }
    }
  }
  return none
}

/** When a peer leaves: the teacher's presence view updates. */
export function onLeave(gone: Peer, remaining: Peer[]): Decision {
  if (!isLive(gone.topic) || !gone.presence) return { deliveries: [] }
  return { deliveries: [{ to: teachersOn(remaining, gone.topic), msg: { t: 'presence', event: 'sync', state: presenceState(remaining) } }] }
}
