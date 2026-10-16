import { describe, it, expect, vi, beforeEach } from 'vitest'

// The orb's two read routes: the briefing (nudges, plan, lessons) and a lesson
// summary. Both read through the student's own session and never call an AI provider.

const state = vi.hoisted(() => ({
  user: null as null | { id: string; role: string },
  lesson: null as null | { id: string; title: string; content: string | null },
  calls: [] as unknown[][],
  briefing: vi.fn(),
}))

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number; headers?: Record<string, string> }) => ({
      status: init?.status ?? 200,
      headers: init?.headers ?? {},
      body,
    }),
  },
}))

vi.mock('@/lib/api-error', () => ({
  apiErr: async (code: string) => ({ error: code, code }),
}))

// A query builder that records every filter, so the test can see what the route asked for.
function builder(result: () => unknown) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit']) {
    b[m] = (...args: unknown[]) => { state.calls.push([m, ...args]); return b }
  }
  b.maybeSingle = async () => ({ data: result(), error: null })
  return b
}

const db = { from: (table: string) => { state.calls.push(['from', table]); return builder(() => state.lesson) } }

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => db,
  getAuthUser: async () => state.user,
}))

vi.mock('@/lib/data/assistant-nudges', () => ({
  loadAssistantBriefing: (...args: unknown[]) => state.briefing(...args),
}))

import { GET as briefing } from '@/app/api/assistant/student/briefing/route'
import { GET as summary } from '@/app/api/assistant/student/summary/route'
import { serializeLessonDoc } from '@/lib/lesson-doc'

type Res = { status: number; body: Record<string, unknown>; headers: Record<string, string> }
const LESSON_ID = '0f8e3c2a-1b4d-4e5f-8a9b-0c1d2e3f4a5b'
const summaryReq = (q: string) => new Request(`https://eduquest.test/api/assistant/student/summary${q}`)

let fetchSpy: ReturnType<typeof vi.fn>
beforeEach(() => {
  state.user = { id: 'stu-1', role: 'student' }
  state.lesson = null
  state.calls = []
  state.briefing.mockReset()
  state.briefing.mockResolvedValue({ data: { nudges: [{ id: 'welcome', kind: 'welcome', params: {} }], plan: [], lessons: [] }, error: null })
  fetchSpy = vi.fn()
  vi.stubGlobal('fetch', fetchSpy)
})

describe('GET /api/assistant/student/briefing', () => {
  it('needs a signed-in student', async () => {
    state.user = null
    expect(((await briefing()) as unknown as Res).status).toBe(401)
    state.user = { id: 't', role: 'teacher' }
    expect(((await briefing()) as unknown as Res).status).toBe(403)
    expect(state.briefing).not.toHaveBeenCalled()
  })

  it('reads for the caller through their session, uncached, without any provider', async () => {
    const res = (await briefing()) as unknown as Res
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ nudges: [{ id: 'welcome', kind: 'welcome', params: {} }], plan: [], lessons: [] })
    expect(res.headers['Cache-Control']).toBe('private, no-store')
    expect(state.briefing).toHaveBeenCalledWith(db, 'stu-1')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('still answers on a partial read, and logs only a code', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    state.briefing.mockResolvedValue({ data: { nudges: [], plan: [], lessons: [] }, error: { message: 'relation "x" secret detail' } })
    const res = (await briefing()) as unknown as Res
    expect(res.status).toBe(200)
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret detail')
    log.mockRestore()
  })
})

describe('GET /api/assistant/student/summary', () => {
  it('needs a signed-in student', async () => {
    state.user = null
    expect(((await summary(summaryReq(`?lessonId=${LESSON_ID}`))) as unknown as Res).status).toBe(401)
    state.user = { id: 'a', role: 'university_admin' }
    expect(((await summary(summaryReq(`?lessonId=${LESSON_ID}`))) as unknown as Res).status).toBe(403)
    expect(state.calls).toEqual([])
  })

  it('rejects a lesson id that is not a UUID before reading', async () => {
    for (const q of ['', '?lessonId=', '?lessonId=1', "?lessonId=x'%20or%201=1"]) {
      expect(((await summary(summaryReq(q))) as unknown as Res).status).toBe(400)
    }
    expect(state.calls).toEqual([])
  })

  it('answers 403 when RLS returns no row', async () => {
    const res = (await summary(summaryReq(`?lessonId=${LESSON_ID}`))) as unknown as Res
    expect(res.status).toBe(403)
  })

  it('reads one published, live lesson by named columns and summarises it without a provider', async () => {
    state.lesson = {
      id: LESSON_ID,
      title: 'الكسور',
      content: serializeLessonDoc({ eqLesson: 2, sections: [{ id: 's', title: 'مقدمة', blocks: [
        { id: 'b', type: 'text', md: 'الكسر جزء من كل.' },
        { id: 'q', type: 'quiz', intro: '', questions: [{ text: 'سؤال', options: [], answer: 'SECRET-ANSWER' }] },
      ] }] }),
    }
    const res = (await summary(summaryReq(`?lessonId=${LESSON_ID}`))) as unknown as Res
    expect(res.status).toBe(200)
    expect(res.headers['Cache-Control']).toBe('private, no-store')
    expect(state.calls).toEqual([
      ['from', 'lessons'],
      ['select', 'id, title, content'],
      ['eq', 'id', LESSON_ID],
      ['eq', 'is_published', true],
      ['is', 'deleted_at', null],
    ])
    expect(res.body.lessonId).toBe(LESSON_ID)
    expect(res.body.summary).toMatchObject({ title: 'الكسور', sections: [{ title: 'مقدمة', gist: 'الكسر جزء من كل.' }], practice: { quizQuestions: 1, flashcards: 0 } })
    expect(JSON.stringify(res.body)).not.toContain('SECRET-ANSWER')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('the orb\'s read path never imports an AI client', () => {
  it('has no provider module in the route or data files', async () => {
    const fs = await import('node:fs')
    const files = [
      'src/app/api/assistant/student/briefing/route.ts',
      'src/app/api/assistant/student/summary/route.ts',
      'src/lib/data/assistant-nudges.ts',
      'src/lib/assistant/nudges.ts',
      'src/lib/assistant/lesson-summary.ts',
    ]
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8')
      expect(src, f).not.toMatch(/@\/lib\/ai\/|groq|gemini|openrouter|cohere|createServiceClient|service-role/i)
    }
  })
})
