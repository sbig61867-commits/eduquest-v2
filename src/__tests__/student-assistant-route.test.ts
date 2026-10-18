import { describe, it, expect, vi, beforeEach } from 'vitest'

// Route tests with every external dependency mocked. No network, no database.

const state = vi.hoisted(() => ({
  user: null as null | { id: string; role: string },
  lesson: null as null | { id: string; content: string | null },
  rateAllowed: true,
  chat: vi.fn(),
  approved: ['personal', 'institution'] as string[],
  loadAccount: vi.fn(async () => null as string | null),
  allowanceDenied: null as null | Response,
  fullName: 'Lina Haddad' as string | null,
}))

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number; headers?: Record<string, string> }) => ({
      status: init?.status ?? 200,
      headers: init?.headers ?? {},
      body,
      json: async () => body,
    }),
  },
}))

vi.mock('@/lib/api-error', () => ({
  apiErr: async (code: string) => ({ error: code, code }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: table === 'users' ? { full_name: state.fullName } : state.lesson, error: null }),
        }),
      }),
    }),
  }),
  getAuthUser: async () => state.user,
}))

vi.mock('@/lib/rate-limit', () => ({
  aiRateLimit: async () => ({ allowed: state.rateAllowed, remaining: 0, resetAt: Date.now() + 60_000 }),
}))

vi.mock('@/lib/ai/usage', () => ({
  meteredAiRoute: (_feature: string, handler: (req: Request) => Promise<unknown>) => handler,
  authorizeAiUsage: async () => state.allowanceDenied,
}))

vi.mock('@/lib/assistant/student-context', async (orig) => ({
  ...(await orig<typeof import('@/lib/assistant/student-context')>()),
  loadAccountText: () => state.loadAccount(),
  loadLessonIndex: async () => [],
}))

vi.mock('@/lib/ai/privacy', async (orig) => ({
  ...(await orig<typeof import('@/lib/ai/privacy')>()),
  audienceApproved: (audiences: string[]) => audiences.every(a => state.approved.includes(a)),
}))

vi.mock('@/lib/ai/chat', () => ({
  aiChat: (prompt: string, system: string, opts?: unknown) => state.chat(prompt, system, opts),
}))

import { POST } from '@/app/api/assistant/student/route'

const LESSON_ID = '0f8e3c2a-1b4d-4e5f-8a9b-0c1d2e3f4a5b'

function req(body: unknown): Request {
  return new Request('https://eduquest.test/api/assistant/student', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

type Res = { status: number; body: Record<string, unknown>; headers: Record<string, string> }
const call = async (body: unknown): Promise<Res> => {
  const r = (await POST(req(body))) as unknown as Res
  return r
}

beforeEach(() => {
  state.user = { id: 'stu-1', role: 'student' }
  state.lesson = { id: LESSON_ID, content: 'Plain lesson text about cells.' }
  state.rateAllowed = true
  state.allowanceDenied = null
  state.chat.mockReset()
  state.chat.mockResolvedValue('A cell is the smallest unit of life.')
  state.approved = ['personal', 'institution']
  state.loadAccount.mockReset()
  state.loadAccount.mockResolvedValue(null)
})

describe('student assistant route — access', () => {
  it('401 when there is no session', async () => {
    state.user = null
    const r = await call({ message: 'hi' })
    expect(r.status).toBe(401)
    expect(state.chat).not.toHaveBeenCalled()
  })

  it('403 for a non-student role', async () => {
    state.user = { id: 't-1', role: 'teacher' }
    const r = await call({ message: 'hi' })
    expect(r.status).toBe(403)
    expect(state.chat).not.toHaveBeenCalled()
  })

  it('403 when the lesson is not visible to the student (RLS returns no row)', async () => {
    state.lesson = null
    const r = await call({ message: 'hi', lessonId: LESSON_ID })
    expect(r.status).toBe(403)
    expect(state.chat).not.toHaveBeenCalled()
  })

  it('429 when the per-student window is exhausted', async () => {
    state.rateAllowed = false
    const r = await call({ message: 'hi' })
    expect(r.status).toBe(429)
    expect(state.chat).not.toHaveBeenCalled()
  })

  it('returns the institution allowance refusal as-is', async () => {
    state.allowanceDenied = new Response(null, { status: 429 }) as unknown as Response
    const r = await call({ message: 'hi' })
    expect(r.status).toBe(429)
    expect(state.chat).not.toHaveBeenCalled()
  })
})

describe('student assistant route — input', () => {
  it('400 for a malformed body, without calling the provider', async () => {
    const r = await call({ mode: 'write_exam', message: 'x' })
    expect(r.status).toBe(400)
    expect(state.chat).not.toHaveBeenCalled()
  })

  it('400 for an invalid lesson id', async () => {
    const r = await call({ message: 'x', lessonId: "1' OR '1'='1" })
    expect(r.status).toBe(400)
  })
})

describe('student assistant route — content policy', () => {
  it('422 when the lesson carries an unsupported answer marker, and sends nothing', async () => {
    state.lesson = { id: LESSON_ID, content: 'Problem 1: x+1=3\nSolution: x=2' }
    const r = await call({ message: 'explain', lessonId: LESSON_ID })
    expect(r.status).toBe(422)
    expect(r.body.code).toBe('assistantContentRefused')
    expect(state.chat).not.toHaveBeenCalled()
  })

  it('a selected passage with an inline answer reaches the model without the answer', async () => {
    const r = await call({ message: 'explain', mode: 'explain', selection: 'Q: 2+2? Answer: 4' })
    expect(r.status).toBe(200)
    const [prompt] = state.chat.mock.calls[0] as [string]
    expect(prompt).toContain('Q: 2+2?')
    expect(prompt).not.toMatch(/Answer:\s*4/)
  })

  it('422 when a selected passage carries an unsupported marker', async () => {
    const r = await call({ message: 'explain', mode: 'explain', selection: 'Solution: x = 2' })
    expect(r.status).toBe(422)
    expect(state.chat).not.toHaveBeenCalled()
  })

  it('does not send an inline answer from the lesson to the model (question kept, answer removed)', async () => {
    state.lesson = { id: LESSON_ID, content: 'Intro about cells.\n\n5. What is 2 + 2? Answer: 4' }
    const r = await call({ message: 'summarise', lessonId: LESSON_ID })
    expect(r.status).toBe(200)
    const [prompt] = state.chat.mock.calls[0] as [string]
    expect(prompt).toContain('5. What is 2 + 2?')
    expect(prompt).not.toMatch(/Answer:\s*4/)
  })

  it('does not send a dash-separated answer ("Answer - B") to the model', async () => {
    state.lesson = { id: LESSON_ID, content: 'Quiz\n1. Colour?\nAnswer - B\n\nNext text.' }
    const r = await call({ message: 'summarise', lessonId: LESSON_ID })
    expect(r.status).toBe(200)
    const [prompt] = state.chat.mock.calls[0] as [string]
    expect(prompt).not.toMatch(/Answer\s*-\s*B/)
    expect(prompt).toContain('Next text.')
  })
})

describe('student assistant route — success path', () => {
  it('200 with the answer; the prompt holds the lesson but not the quiz answer', async () => {
    state.lesson = { id: LESSON_ID, content: 'Chlorophyll absorbs light.\n\n1. Colour?\nA) red\nB) green\n**Answer:** B' }
    const r = await call({ message: 'what does chlorophyll do?', lessonId: LESSON_ID, mode: 'chat' })
    expect(r.status).toBe(200)
    expect(r.body.answer).toBe('A cell is the smallest unit of life.')
    expect(r.body.truncated).toBe(false)

    const [prompt, system] = state.chat.mock.calls[0] as [string, string, { temperature: number }]
    expect(prompt).toContain('Chlorophyll absorbs light.')
    expect(prompt).not.toMatch(/\*\*Answer/)
    expect(prompt).not.toContain('Answer: B')
    expect(system).toMatch(/Never reveal or guess the answers/)
  })

  it('answers a general question with no lesson at all', async () => {
    const r = await call({ message: 'what is a cell?' })
    expect(r.status).toBe(200)
    expect(state.chat).toHaveBeenCalledTimes(1)
  })

  it('reports truncation for a lesson longer than the model window', async () => {
    state.lesson = { id: LESSON_ID, content: 'word '.repeat(5000) }
    const r = await call({ message: 'summarise', lessonId: LESSON_ID, mode: 'summarize' })
    expect(r.status).toBe(200)
    expect(r.body.truncated).toBe(true)
  })

  it('503 when no provider is configured', async () => {
    state.chat.mockRejectedValue(new Error('No AI provider configured'))
    const r = await call({ message: 'hi' })
    expect(r.status).toBe(503)
    expect(r.body.code).toBe('noAiProvider')
  })

  it('500 when the provider fails, with a generic message', async () => {
    state.chat.mockRejectedValue(new Error('upstream 500 secret-detail'))
    const r = await call({ message: 'hi' })
    expect(r.status).toBe(500)
    expect(JSON.stringify(r.body)).not.toContain('secret-detail')
  })
})

describe('student assistant route — privacy gate', () => {
  it('a general question is sent as the student message (personal), with no notices', async () => {
    const r = await call({ message: 'what is a cell?' })
    expect(r.status).toBe(200)
    expect(r.body.notices).toEqual([])
    const [, , opts] = state.chat.mock.calls[0] as [string, string, { audiences: string[] }]
    expect(opts.audiences).toEqual(['personal'])
  })

  it('refuses every message while personal content has no approved provider (default)', async () => {
    state.approved = ['institution']
    state.lesson = { id: LESSON_ID, content: 'Plain lesson text about cells.' }
    const r = await call({ message: 'what is a cell?', lessonId: LESSON_ID })
    expect(r.status).toBe(503)
    expect(r.body.code).toBe('aiPrivacyPending')
    expect(state.chat).not.toHaveBeenCalled()
    expect(state.loadAccount).not.toHaveBeenCalled()
  })

  it('withholds the lesson when no provider is approved for institution content, and says so', async () => {
    state.approved = ['personal']
    state.lesson = { id: LESSON_ID, content: 'Chlorophyll absorbs light.' }
    const r = await call({ message: 'what does chlorophyll do?', lessonId: LESSON_ID })
    expect(r.status).toBe(200)
    const [prompt] = state.chat.mock.calls[0] as [string]
    expect(prompt).not.toContain('Chlorophyll absorbs light.')
    expect(r.body.notices).toEqual([{ code: 'assistantLessonUnavailable', error: 'assistantLessonUnavailable' }])
  })

  it('withholds a selected passage the same way', async () => {
    state.approved = ['personal']
    const r = await call({ message: 'explain', mode: 'explain', selection: 'Photosynthesis needs light.' })
    expect(r.status).toBe(200)
    const [prompt] = state.chat.mock.calls[0] as [string]
    expect(prompt).not.toContain('Photosynthesis needs light.')
    expect(r.body.notices).toEqual([{ code: 'assistantLessonUnavailable', error: 'assistantLessonUnavailable' }])
  })

  it('never loads or sends account data (grades, groups, announcements), even when asked', async () => {
    state.loadAccount.mockResolvedValue('Published grades:\n- Quiz 1: 8/10')
    const r = await call({ message: 'what are my grades?' })
    expect(r.status).toBe(200)
    expect(state.loadAccount).not.toHaveBeenCalled()
    const [prompt, , opts] = state.chat.mock.calls[0] as [string, string, { audiences: string[] }]
    expect(prompt).not.toContain('Quiz 1')
    expect(opts.audiences).toEqual(['personal'])
    expect(r.body.notices).toEqual([{ code: 'assistantAccountUnavailable', error: 'assistantAccountUnavailable' }])
  })

  it('takes the student name, contact details and identifiers out of the message, selection and history', async () => {
    await call({
      message: 'I am Lina, my number is 0599123456 and mail lina.h@school.edu. Explain osmosis?',
      selection: 'Osmosis moves water. (Lina Haddad notes)',
      history: [{ role: 'user', content: 'Haddad here, id 402918377' }],
    })
    const [prompt] = state.chat.mock.calls[0] as [string]
    expect(prompt).toContain('Explain osmosis?')
    expect(prompt).toContain('Osmosis moves water.')
    expect(prompt).not.toMatch(/Lina|Haddad|0599123456|lina\.h|402918377/)
  })

  it('keeps earlier turns only because the message itself is personal-approved', async () => {
    await call({ message: 'and then?', history: [{ role: 'assistant', content: 'Your grade is 8 out of 10' }] })
    const [prompt] = state.chat.mock.calls[0] as [string]
    expect(prompt).toContain('Your grade is 8 out of 10')
  })

  it('logs the provider status code only, never its message', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    state.chat.mockRejectedValue(new Error('upstream 500 secret-detail'))
    await call({ message: 'hi' })
    expect(JSON.stringify(spy.mock.calls)).not.toContain('secret-detail')
    spy.mockRestore()
  })
})
