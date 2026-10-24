// One Durable Object per exam (step 13): the live channel that replaced
// Supabase Realtime. worker.ts verifies the join ticket and forwards the
// WebSocket here with the caller's id, role and topic in x-live-* headers; the
// page never chooses them. What is relayed to whom is decided by the pure
// rules in src/lib/live-relay.ts. Hibernation API: idle exams cost nothing.
//
// Built by wrangler from worker.ts (not part of the Next build, not in tsconfig).

import { decide, onLeave, presenceState, isLive, type Peer, type ServerMsg } from '../src/lib/live-relay'

type Attachment = Omit<Peer, 'presence'> & { presence?: Record<string, number> }

interface WS {
  send(data: string): void
  close(code?: number, reason?: string): void
  serializeAttachment(value: unknown): void
  deserializeAttachment(): unknown
}
interface State {
  acceptWebSocket(ws: WS): void
  getWebSockets(): WS[]
}
declare const WebSocketPair: { new (): { 0: WS; 1: WS } }

export class ExamLive {
  constructor(private readonly state: State) {}

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('expected a websocket', { status: 426 })
    const userId = request.headers.get('x-live-user')
    const role = request.headers.get('x-live-role')
    const topic = request.headers.get('x-live-topic')
    if (!userId || (role !== 'teacher' && role !== 'student') || !topic) return new Response('forbidden', { status: 403 })

    const pair = new WebSocketPair()
    const client = pair[0], server = pair[1]
    this.state.acceptWebSocket(server)
    const me: Attachment = { userId, role, topic }
    server.serializeAttachment(me)
    // The teacher's page learns who is already in the exam.
    if (role === 'teacher' && isLive(topic)) {
      server.send(JSON.stringify({ t: 'presence', event: 'sync', state: presenceState(this.peers().map(p => p.peer)) } satisfies ServerMsg))
    }
    return new Response(null, { status: 101, webSocket: client } as ResponseInit & { webSocket: WS })
  }

  webSocketMessage(ws: WS, message: string | ArrayBuffer) {
    if (typeof message !== 'string') return
    const all = this.peers()
    const self = all.find(p => p.ws === ws)
    if (!self) return
    const decision = decide(self.peer, message, all.map(p => p.peer))
    if (decision.presence) ws.serializeAttachment({ ...self.peer, presence: decision.presence })
    this.deliver(all, decision.deliveries)
  }

  webSocketClose(ws: WS) { this.leave(ws) }
  webSocketError(ws: WS) { this.leave(ws) }

  private leave(ws: WS) {
    const all = this.peers()
    const gone = all.find(p => p.ws === ws)
    const remaining = all.filter(p => p.ws !== ws)
    if (gone) this.deliver(remaining, onLeave(gone.peer, remaining.map(p => p.peer)).deliveries)
    try { ws.close(1000, 'bye') } catch { /* already closed */ }
  }

  private peers(): { ws: WS; peer: Peer }[] {
    return this.state.getWebSockets().flatMap(ws => {
      const a = ws.deserializeAttachment() as Attachment | null
      return a ? [{ ws, peer: a }] : []
    })
  }

  private deliver(all: { ws: WS; peer: Peer }[], deliveries: { to: Peer[]; msg: ServerMsg }[]) {
    for (const d of deliveries) {
      const text = JSON.stringify(d.msg)
      // decide() returns the very peer objects it was given: every connection
      // of a chosen peer receives it (a user with two tabs gets both).
      for (const conn of all.filter(p => d.to.includes(p.peer))) {
        try { conn.ws.send(text) } catch { /* closing */ }
      }
    }
  }
}
