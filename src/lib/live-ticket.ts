// Live-channel join tickets (step 13: Supabase Realtime → a Durable Object per
// exam). GET /api/live/ticket checks who may join a topic — the same rule as the
// old Realtime policy, public.exam_topic_role(): the exam's own teacher, or a
// student with an attempt in progress — and signs a short-lived ticket. The
// Worker (worker.ts) verifies it before the WebSocket reaches the Durable
// Object, which then knows the caller's id and role without trusting the page.
//
// No '@/…' imports and no Node APIs: worker.ts bundles this file too.

export type LiveRole = 'teacher' | 'student'
export interface LiveTicket { topic: string; userId: string; role: LiveRole }

/** Enough to open the socket; the socket itself lives on after. */
export const LIVE_TICKET_SECONDS = 60

const TOPIC_RE = /^exam-(live|thumbs):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export const isLiveTopic = (topic: unknown): topic is string => typeof topic === 'string' && TOPIC_RE.test(topic)
export const examOfTopic = (topic: string) => topic.slice(topic.indexOf(':') + 1)

const enc = new TextEncoder()
const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))

async function hmacKey(secret: string | undefined): Promise<CryptoKey> {
  if (!secret || secret.length < 32) throw new Error('live: LIVE_SIGNING_SECRET is missing or shorter than 32 characters')
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function signLiveTicket(secret: string | undefined, t: LiveTicket, now = Date.now()): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify({ t: t.topic, u: t.userId, r: t.role, e: Math.floor(now / 1000) + LIVE_TICKET_SECONDS })))
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body)))
  return `${body}.${b64url(sig)}`
}

/** The ticket's content when it is genuine, unexpired and well formed; null otherwise. */
export async function verifyLiveTicket(secret: string | undefined, ticket: string | null, now = Date.now()): Promise<LiveTicket | null> {
  if (!ticket || ticket.length > 2048) return null
  const [body, sig] = ticket.split('.')
  if (!body || !sig) return null
  try {
    if (!(await crypto.subtle.verify('HMAC', await hmacKey(secret), fromB64url(sig), enc.encode(body)))) return null
    const p = JSON.parse(new TextDecoder().decode(fromB64url(body))) as { t?: unknown; u?: unknown; r?: unknown; e?: unknown }
    if (!isLiveTopic(p.t) || typeof p.u !== 'string' || !/^[0-9a-f-]{36}$/i.test(p.u)) return null
    if (p.r !== 'teacher' && p.r !== 'student') return null
    if (typeof p.e !== 'number' || p.e * 1000 < now) return null
    return { topic: p.t, userId: p.u, role: p.r }
  } catch {
    return null
  }
}
