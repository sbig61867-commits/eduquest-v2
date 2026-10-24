// The browser side of the per-exam live channel (step 13). It offers the same
// small surface the pages used from Supabase Realtime — channel(topic),
// on('presence' | 'broadcast', { event }, fn), subscribe(cb), track(), send(),
// httpSend(), presenceState(), removeChannel() — so the student hook, the
// thumbnail sender and the teacher's monitor keep their logic unchanged.
//
// Joining: GET /api/live/ticket (the access check), then a WebSocket to
// /live/<topic>?ticket=… on the Worker (worker.ts → live/exam-live.ts). A
// dropped socket reconnects with a fresh ticket, backing off up to 30 s.
// Under `next dev` there is no Worker: joining fails and the pages show their
// "live view unavailable" state, exactly as when the channel was not permitted.

type Status = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED'
type Presence = Record<string, Record<string, unknown>[]>
type Handler =
  | { type: 'broadcast'; event: string; fn: (arg: { payload: unknown }) => void }
  | { type: 'presence'; event: string; fn: (arg: { key?: string }) => void }

const MAX_BACKOFF_MS = 30_000
const OPEN_TIMEOUT_MS = 15_000

export class LiveChannel {
  private handlers: Handler[] = []
  private ws: WebSocket | null = null
  private state: Presence = {}
  private statusCb: ((status: Status) => void) | null = null
  private closed = false
  private backoff = 1_000
  private pendingTrack: unknown = undefined
  private connecting: Promise<boolean> | null = null
  private refused = false

  constructor(readonly topic: string) {}

  on(type: 'broadcast', filter: { event: string }, fn: (arg: { payload: unknown }) => void): this
  on(type: 'presence', filter: { event: string }, fn: (arg: { key?: string }) => void): this
  on(type: 'broadcast' | 'presence', filter: { event: string }, fn: (arg: never) => void): this {
    this.handlers.push({ type, event: filter.event, fn } as Handler)
    return this
  }

  subscribe(cb?: (status: Status) => void): this {
    this.statusCb = cb ?? null
    void this.connect()
    return this
  }

  /** Announce this page's presence (the server keeps only the counts it allows). */
  async track(payload: unknown): Promise<'ok' | 'error'> {
    this.pendingTrack = payload
    return this.write({ t: 'track', payload }) ? 'ok' : 'error'
  }

  async send(msg: { type: 'broadcast'; event: string; payload: unknown }): Promise<'ok' | 'error'> {
    return this.write({ t: 'broadcast', event: msg.event, payload: msg.payload }) ? 'ok' : 'error'
  }

  /** Fire-and-forget send that opens the socket on first use (the thumbnail sender never subscribes). */
  async httpSend(event: string, payload: unknown): Promise<{ success: boolean; status: number }> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      const ok = await this.connect()
      if (!ok) return { success: false, status: this.refused ? 403 : 503 }
    }
    return this.write({ t: 'broadcast', event, payload }) ? { success: true, status: 202 } : { success: false, status: 503 }
  }

  presenceState<T = Record<string, unknown>>(): Record<string, T[]> {
    return this.state as Record<string, T[]>
  }

  close(): void {
    this.closed = true
    try { this.ws?.close(1000, 'bye') } catch { /* already closed */ }
    this.ws = null
  }

  private write(msg: unknown): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false
    try { this.ws.send(JSON.stringify(msg)); return true } catch { return false }
  }

  private emit(type: Handler['type'], event: string, arg: unknown) {
    for (const h of this.handlers) if (h.type === type && h.event === event) (h.fn as (a: unknown) => void)(arg)
  }

  private connect(): Promise<boolean> {
    if (this.connecting) return this.connecting
    this.connecting = this.open().finally(() => { this.connecting = null })
    return this.connecting
  }

  private async open(): Promise<boolean> {
    if (this.closed) return false
    const res = await fetch(`/api/live/ticket?topic=${encodeURIComponent(this.topic)}`, { cache: 'no-store' }).catch(() => null)
    if (!res?.ok) {
      this.refused = res?.status === 401 || res?.status === 403
      this.statusCb?.('CHANNEL_ERROR')
      if (!this.refused) this.retry()
      return false
    }
    const { ticket } = await res.json() as { ticket: string }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/live/${encodeURIComponent(this.topic)}?ticket=${encodeURIComponent(ticket)}`)
    this.ws = ws
    return new Promise<boolean>(resolve => {
      const timer = setTimeout(() => { this.statusCb?.('TIMED_OUT'); try { ws.close() } catch {} resolve(false) }, OPEN_TIMEOUT_MS)
      ws.onopen = () => {
        clearTimeout(timer)
        this.backoff = 1_000
        this.statusCb?.('SUBSCRIBED')
        if (this.pendingTrack !== undefined) this.write({ t: 'track', payload: this.pendingTrack })
        resolve(true)
      }
      ws.onmessage = e => {
        let msg: { t?: string; event?: string; state?: Presence; key?: string; payload?: unknown }
        try { msg = JSON.parse(String(e.data)) } catch { return }
        if (msg.t === 'presence' && msg.event === 'sync' && msg.state) { this.state = msg.state; this.emit('presence', 'sync', {}) }
        else if (msg.t === 'presence' && msg.event === 'join') this.emit('presence', 'join', { key: msg.key })
        else if (msg.t === 'broadcast' && typeof msg.event === 'string') this.emit('broadcast', msg.event, { payload: msg.payload })
      }
      ws.onclose = () => {
        clearTimeout(timer)
        if (this.ws === ws) this.ws = null
        resolve(false)
        if (!this.closed) { this.statusCb?.('CLOSED'); this.retry() }
      }
      ws.onerror = () => { /* onclose follows */ }
    })
  }

  private retry() {
    if (this.closed) return
    const wait = this.backoff
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS)
    setTimeout(() => { if (!this.closed && (!this.ws || this.ws.readyState > WebSocket.OPEN)) void this.connect() }, wait)
  }
}

/** The live client: one object per page, like the Supabase browser client it replaces. */
export function createLiveClient() {
  return {
    channel: (topic: string, _opts?: unknown) => new LiveChannel(topic),
    removeChannel: (channel: LiveChannel) => channel.close(),
    // The ticket carries the caller's identity; nothing to authorise on the socket.
    realtime: { setAuth: async () => {} },
  }
}
