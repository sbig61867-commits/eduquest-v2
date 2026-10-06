import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Gate 5 — Sentry load timing. The routine load of the browser SDK waits for the
 * page's `load` event, then the next idle moment (scheduleSentryLoad); an error
 * boundary loads it at once (reportClientError). loadSentry() memoises one
 * promise, so the SDK is imported and initialised once whatever the order.
 */

// init runs once per successful import() of the SDK (loadSentry), so its call
// count is the load count. (A counter in the vi.mock factory would not do: the
// factory runs once per file, not once per vi.resetModules().)
const sdk = vi.hoisted(() => ({ init: vi.fn(), captureException: vi.fn() }))
vi.mock('@/lib/sentry-sdk', () => ({ init: sdk.init, captureException: sdk.captureException }))

let readyState: DocumentReadyState
let idle: Array<() => void>
// import() of the mocked SDK resolves on a later macrotask, not a microtask.
const flush = () => new Promise<void>(r => setTimeout(r, 30))
const added: EventListenerOrEventListenerObject[] = []
const runIdle = () => { const cbs = idle; idle = []; cbs.forEach(cb => cb()) }

async function client() {
  vi.resetModules()
  return import('@/lib/sentry-client')
}

beforeEach(() => {
  sdk.init.mockClear()
  sdk.captureException.mockClear()
  idle = []
  readyState = 'loading'
  Object.defineProperty(document, 'readyState', { configurable: true, get: () => readyState })
  ;(window as unknown as { requestIdleCallback: unknown }).requestIdleCallback = vi.fn((cb: () => void) => { idle.push(cb); return idle.length })
  vi.stubEnv('NODE_ENV', 'production')
  // Each test schedules on a fresh module; record its `load` listeners so none
  // left waiting fires in a later test.
  const orig = window.addEventListener.bind(window)
  vi.spyOn(window, 'addEventListener').mockImplementation((type: string, fn: EventListenerOrEventListenerObject, opts?: boolean | AddEventListenerOptions) => {
    if (type === 'load') added.push(fn)
    orig(type, fn, opts)
  })
})

afterEach(() => {
  added.splice(0).forEach(fn => window.removeEventListener('load', fn))
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.useRealTimers()
  delete (document as unknown as { readyState?: unknown }).readyState
})

const fireLoad = () => { readyState = 'complete'; window.dispatchEvent(new Event('load')) }

describe('scheduleSentryLoad — routine load only after `load`, then idle', () => {
  it('T1: before the load event nothing is imported or initialised', async () => {
    const { scheduleSentryLoad } = await client()
    scheduleSentryLoad()
    runIdle()
    await flush()
    expect(window.requestIdleCallback).not.toHaveBeenCalled()
    expect(sdk.init).not.toHaveBeenCalled()
    expect(sdk.init).not.toHaveBeenCalled()
  })

  it('T2: after the load event but before idle — still nothing', async () => {
    const { scheduleSentryLoad } = await client()
    scheduleSentryLoad()
    fireLoad()
    await flush()
    expect(window.requestIdleCallback).toHaveBeenCalledTimes(1)
    expect(sdk.init).not.toHaveBeenCalled()
  })

  it('T3: load then idle — one import, one init with the unchanged options', async () => {
    const { scheduleSentryLoad } = await client()
    scheduleSentryLoad()
    fireLoad()
    expect(window.requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 5000 })
    runIdle()
    await flush()
    expect(sdk.init).toHaveBeenCalledTimes(1)
    expect(sdk.init).toHaveBeenCalledWith({ dsn: expect.stringContaining('ingest.de.sentry.io'), tracesSampleRate: 0 })
  })

  it('T1b: interactive (DOMContentLoaded passed, load not yet) — same as loading: waits for load, then idle', async () => {
    readyState = 'interactive'
    const { scheduleSentryLoad } = await client()
    scheduleSentryLoad()
    runIdle()
    await flush()
    expect(window.requestIdleCallback).not.toHaveBeenCalled()
    expect(sdk.init).not.toHaveBeenCalled()
    fireLoad()
    await flush()
    expect(sdk.init).not.toHaveBeenCalled() // load alone is not enough — idle first
    runIdle()
    await flush()
    expect(sdk.init).toHaveBeenCalledTimes(1)
  })

  it('T4: page already complete when scheduled — waits for idle only', async () => {
    readyState = 'complete'
    const { scheduleSentryLoad } = await client()
    scheduleSentryLoad()
    expect(window.requestIdleCallback).toHaveBeenCalledTimes(1)
    expect(sdk.init).not.toHaveBeenCalled()
    runIdle()
    await flush()
    expect(sdk.init).toHaveBeenCalledTimes(1)
  })

  it('T5: no requestIdleCallback — setTimeout 3000 after the load event', async () => {
    vi.useFakeTimers()
    delete (window as unknown as { requestIdleCallback?: unknown }).requestIdleCallback
    const { scheduleSentryLoad } = await client()
    scheduleSentryLoad()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(sdk.init).not.toHaveBeenCalled() // no load event yet
    fireLoad()
    await vi.advanceTimersByTimeAsync(2_999)
    expect(sdk.init).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    vi.useRealTimers()
    await flush()
    expect(sdk.init).toHaveBeenCalledTimes(1)
  })
})

describe('reportClientError — error boundaries load Sentry at once, never twice', () => {
  it('T6: an error before the load event loads the SDK, then reports it', async () => {
    const { scheduleSentryLoad, reportClientError } = await client()
    scheduleSentryLoad()
    const err = new Error('early')
    reportClientError(err)
    await flush()
    expect(sdk.init).toHaveBeenCalledTimes(1)
    expect(sdk.captureException).toHaveBeenCalledWith(err)
  })

  it('T7: an early error, then load + idle — init still once', async () => {
    const { scheduleSentryLoad, reportClientError } = await client()
    scheduleSentryLoad()
    reportClientError(new Error('early'))
    await flush()
    fireLoad()
    runIdle()
    await flush()
    expect(sdk.init).toHaveBeenCalledTimes(1)
  })

  it('T8: an error after the routine load — no second load', async () => {
    const { scheduleSentryLoad, reportClientError } = await client()
    scheduleSentryLoad()
    fireLoad()
    runIdle()
    await flush()
    reportClientError(new Error('late'))
    await flush()
    expect(sdk.init).toHaveBeenCalledTimes(1)
    expect(sdk.captureException).toHaveBeenCalledTimes(1)
  })

  it('T9: two simultaneous errors before any load — one load, two reports', async () => {
    const { reportClientError } = await client()
    reportClientError(new Error('a'))
    reportClientError(new Error('b'))
    await flush()
    expect(sdk.init).toHaveBeenCalledTimes(1)
    expect(sdk.captureException).toHaveBeenCalledTimes(2)
  })

  it('T10: outside production nothing loads, scheduled or reported (unchanged)', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    const { scheduleSentryLoad, reportClientError } = await client()
    scheduleSentryLoad()
    fireLoad()
    runIdle()
    reportClientError(new Error('dev'))
    await flush()
    expect(sdk.init).not.toHaveBeenCalled()
    expect(sdk.init).not.toHaveBeenCalled()
    expect(sdk.captureException).not.toHaveBeenCalled()
  })
})

describe('T11: server-side Sentry and the client entry', () => {
  const src = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8')

  it('server instrumentation is untouched and never uses the browser scheduler', () => {
    const server = src('src/instrumentation.ts')
    expect(server).toContain("import('../sentry.server.config')")
    expect(server).not.toContain('sentry-client')
    expect(server).not.toContain('scheduleSentryLoad')
  })

  it('the client entry only delegates to scheduleSentryLoad (no early idle callback of its own)', () => {
    const entry = src('src/instrumentation-client.ts')
    expect(entry).toContain('scheduleSentryLoad()')
    expect(entry).not.toContain('requestIdleCallback')
    expect(entry).not.toContain('loadSentry')
  })
})
