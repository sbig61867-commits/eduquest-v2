// The Worker entry. OpenNext builds the app into .open-next/worker.js; this
// file wraps it with what Next itself cannot do on Workers:
//  - the scheduled handler (step 12): Cloudflare Cron Triggers
//    (wrangler.jsonc → triggers.crons) run POST /api/cron/daily through the
//    same app handler, so the job uses the app's database layer and bindings;
//  - the live channel (step 13): GET /live/<topic>?ticket=… upgrades to a
//    WebSocket on the exam's Durable Object (live/exam-live.ts). The ticket,
//    signed by GET /api/live/ticket after its access check, is verified here;
//    the Durable Object receives the caller's id, role and topic only from
//    this file, never from the page.

// @ts-expect-error: produced by `opennextjs-cloudflare build`
import { default as app } from './.open-next/worker.js'
import { examOfTopic, verifyLiveTicket } from './src/lib/live-ticket'

// @ts-expect-error: produced by `opennextjs-cloudflare build`
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from './.open-next/worker.js'
export { ExamLive } from './live/exam-live'

type DurableObjectStub = { fetch(request: Request): Promise<Response> }
type Env = {
  CRON_SECRET?: string
  LIVE_SIGNING_SECRET?: string
  EXAM_LIVE: { idFromName(name: string): unknown; get(id: unknown): DurableObjectStub }
} & Record<string, unknown>

async function liveUpgrade(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('expected a websocket', { status: 426 })
  const topic = decodeURIComponent(url.pathname.slice('/live/'.length))
  const ticket = await verifyLiveTicket(env.LIVE_SIGNING_SECRET, url.searchParams.get('ticket'))
  if (!ticket || ticket.topic !== topic) return new Response('forbidden', { status: 403 })
  // Only the headers this file sets reach the Durable Object.
  const headers = new Headers({ upgrade: 'websocket', 'x-live-user': ticket.userId, 'x-live-role': ticket.role, 'x-live-topic': ticket.topic })
  for (const h of ['sec-websocket-key', 'sec-websocket-version', 'sec-websocket-protocol', 'sec-websocket-extensions']) {
    const v = request.headers.get(h)
    if (v) headers.set(h, v)
  }
  const stub = env.EXAM_LIVE.get(env.EXAM_LIVE.idFromName(examOfTopic(ticket.topic)))
  return stub.fetch(new Request(url.toString(), { headers }))
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/live/')) return liveUpgrade(request, env, url)
    return app.fetch(request, env, ctx)
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const request = new Request('https://cron.internal/api/cron/daily', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.CRON_SECRET ?? ''}` },
    })
    ctx.waitUntil(
      Promise.resolve(app.fetch(request, env, ctx)).then(async (res: Response) => {
        const body = await res.text()
        if (!res.ok) console.error('[cron] daily failed', res.status, body)
        else console.log('[cron] daily', body)
      }),
    )
  },
}
