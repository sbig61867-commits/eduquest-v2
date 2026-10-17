import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render as rtlRender, screen, fireEvent, act, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import arMessages from '@/messages/ar'
import { AssistantOrb, ORB_TIMING } from '@/components/assistant/assistant-orb'
import type { Nudge, PlanItem } from '@/lib/assistant/nudges'
import type { LessonSummary } from '@/lib/assistant/lesson-summary'

// The study assistant's orb: cloud messages one at a time, a panel with four tabs.

const prefetch = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ prefetch, push: vi.fn(), refresh: vi.fn() }) }))

const render = (ui: React.ReactElement) =>
  rtlRender(<NextIntlClientProvider locale="ar" messages={arMessages}>{ui}</NextIntlClientProvider>)

const NUDGES: Nudge[] = [
  { id: 'due:e1', kind: 'due', params: { title: 'واجب الكسور', days: 1, type: 'homework' }, href: '/student/exams' },
  { id: 'lesson:l1', kind: 'lesson', params: { title: 'الجمع' }, lessonId: 'l1', href: '/student/lessons/l1' },
  { id: 'quiet:l2', kind: 'quiet', params: { title: 'الطرح' }, lessonId: 'l2' },
]
const PLAN: PlanItem[] = [
  { examId: 'e2', title: 'اختبار الوحدة', type: 'exam', event: 'opens', days: 3, reviewInDays: 1, lessonId: 'l1', lesson: 'الجمع' },
]
const LESSONS = [{ id: 'l1', title: 'الجمع', created_at: '2026-10-14T00:00:00Z' }, { id: 'l2', title: 'الطرح', created_at: '2026-10-01T00:00:00Z' }]
const SUMMARY: LessonSummary = {
  title: 'الجمع', readingMinutes: 4, sectionCount: 2,
  sections: [{ title: 'مقدمة', gist: 'الجمع ضمّ عددين.' }],
  keyPoints: ['ابدأ بالآحاد'], terms: ['المجموع'], concepts: { root: 'الجمع', branches: ['الآحاد', 'العشرات'] },
  practice: { quizQuestions: 3, flashcards: 0 },
}

let fetchMock: ReturnType<typeof vi.fn>
let reduceMotion = false

function respond(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: async () => body })
}

beforeEach(() => {
  vi.useFakeTimers()
  prefetch.mockReset()
  sessionStorage.clear()
  reduceMotion = false
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('reduce') ? reduceMotion : false,
    addEventListener: () => {}, removeEventListener: () => {},
  }))
  fetchMock = vi.fn((url: string) => {
    if (url.startsWith('/api/assistant/student/briefing')) return respond({ nudges: NUDGES, plan: PLAN, lessons: LESSONS })
    if (url.startsWith('/api/assistant/student/summary')) return respond({ lessonId: 'l1', summary: SUMMARY })
    return respond({}, false)
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
// Each timer is scheduled by an effect after the previous one re-renders, so the
// cycle is walked one step at a time.
async function steps(...ms: number[]) { for (const m of ms) await advance(m) }
const bubble = () => screen.queryByTestId('orb-bubble')
const visible = () => bubble()?.getAttribute('aria-hidden') === 'false'

async function mountReady(chatEnabled = false) {
  const utils = render(<AssistantOrb chatEnabled={chatEnabled} />)
  await advance(ORB_TIMING.fetchDelay)
  return utils
}

describe('AssistantOrb — cloud messages', () => {
  it('waits before asking for the briefing, then shows the messages one at a time', async () => {
    render(<AssistantOrb chatEnabled={false} />)
    expect(screen.getByRole('button', { name: 'افتح المساعد الدراسي' })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()

    await advance(ORB_TIMING.fetchDelay)
    expect(fetchMock).toHaveBeenCalledWith('/api/assistant/student/briefing')
    expect(visible()).toBe(false)

    await advance(ORB_TIMING.firstDelay)
    expect(visible()).toBe(true)
    expect(bubble()).toHaveTextContent('الواجب «واجب الكسور» ينتهي غدًا')

    await advance(ORB_TIMING.show)
    expect(visible()).toBe(false)

    await advance(ORB_TIMING.gap)
    expect(visible()).toBe(true)
    expect(bubble()).toHaveTextContent('درس جديد: «الجمع»')
  })

  it('rests after the last message before starting over', async () => {
    await mountReady()
    await advance(ORB_TIMING.firstDelay)
    for (let i = 0; i < NUDGES.length - 1; i++) await steps(ORB_TIMING.show, ORB_TIMING.gap)
    expect(bubble()).toHaveTextContent('الطرح')
    await steps(ORB_TIMING.show, ORB_TIMING.gap)
    expect(visible()).toBe(false)
    await advance(ORB_TIMING.roundRest - ORB_TIMING.gap)
    expect(visible()).toBe(true)
    expect(bubble()).toHaveTextContent('واجب الكسور')
  })

  it('holds a message while the pointer is on it', async () => {
    await mountReady()
    await advance(ORB_TIMING.firstDelay)
    fireEvent.mouseEnter(bubble()!)
    await advance(ORB_TIMING.show * 3)
    expect(visible()).toBe(true)
    expect(bubble()).toHaveTextContent('واجب الكسور')
    fireEvent.mouseLeave(bubble()!)
    await advance(ORB_TIMING.show)
    expect(visible()).toBe(false)
  })

  it('goes quiet for the session when dismissed', async () => {
    const { unmount } = await mountReady()
    await advance(ORB_TIMING.firstDelay)
    fireEvent.click(within(bubble()!).getByRole('button', { name: 'إخفاء الرسائل حتى نهاية الجلسة' }))
    expect(bubble()).toBeNull()
    expect(sessionStorage.getItem('eq-orb-quiet')).toBe('1')
    unmount()

    await mountReady()
    await steps(ORB_TIMING.firstDelay, ORB_TIMING.show)
    expect(bubble()).toBeNull()
    expect(screen.getByRole('button', { name: 'افتح المساعد الدراسي' })).toBeInTheDocument()
  })

  it('counts what needs attention on the orb', async () => {
    await mountReady()
    expect(screen.getByRole('button', { name: 'افتح المساعد الدراسي' })).toHaveTextContent('2')
  })

  it('keeps the orb, without messages, when the briefing fails', async () => {
    fetchMock.mockImplementation(() => respond({}, false))
    await mountReady()
    await steps(ORB_TIMING.firstDelay, ORB_TIMING.show)
    expect(bubble()).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'افتح المساعد الدراسي' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('أهلًا!')
  })

  it('moves only when motion is welcome', async () => {
    const moving = render(<AssistantOrb chatEnabled={false} />)
    expect(moving.container.querySelectorAll('animate').length).toBeGreaterThan(0)
    moving.unmount()
    reduceMotion = true
    const still = render(<AssistantOrb chatEnabled={false} />)
    await advance(0)
    expect(still.container.querySelectorAll('animate')).toHaveLength(0)
  })
})

describe('AssistantOrb — panel', () => {
  it('opens on press, stops the messages, and closes with Escape back to the orb', async () => {
    await mountReady()
    await advance(ORB_TIMING.firstDelay)
    const orb = screen.getByRole('button', { name: 'افتح المساعد الدراسي' })
    fireEvent.click(orb)
    expect(orb).toHaveAttribute('aria-expanded', 'true')
    expect(bubble()).toBeNull()
    const dialog = screen.getByRole('dialog', { name: 'المساعد الدراسي' })
    expect(within(dialog).getAllByRole('tab').map(t => t.textContent)).toEqual(['اليوم', 'خطة المراجعة', 'تلخيص درس', 'اسأل'])
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(NUDGES.length)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(orb).toHaveFocus()
  })

  it('fetches the pages its "Open" links lead to when the panel opens, and a tap closes the panel', async () => {
    await mountReady()
    expect(prefetch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'افتح المساعد الدراسي' }))
    expect(prefetch.mock.calls.map(c => c[0]).sort()).toEqual(['/student/exams', '/student/lessons/l1'])
    const dialog = screen.getByRole('dialog', { name: 'المساعد الدراسي' })
    const open = within(dialog).getAllByRole('link', { name: 'افتح' }).find(a => a.getAttribute('href') === '/student/lessons/l1')!
    fireEvent.click(open)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows the plan with when to start revising', async () => {
    await mountReady()
    fireEvent.click(screen.getByRole('button', { name: 'افتح المساعد الدراسي' }))
    fireEvent.click(screen.getByRole('tab', { name: 'خطة المراجعة' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('اختبار الوحدة')
    expect(dialog).toHaveTextContent('اختبار يبدأ بعد 3 أيام')
    expect(dialog).toHaveTextContent('ابدأ المراجعة غدًا')
    expect(within(dialog).getByRole('button', { name: 'لخّص «الجمع»' })).toBeInTheDocument()
  })

  it('summarises a lesson from a message, once per lesson', async () => {
    await mountReady()
    await steps(ORB_TIMING.firstDelay, ORB_TIMING.show, ORB_TIMING.gap)
    fireEvent.click(within(bubble()!).getByRole('button', { name: 'لخّص الدرس' }))
    await advance(0)
    const dialog = screen.getByRole('dialog')
    expect(fetchMock).toHaveBeenCalledWith('/api/assistant/student/summary?lessonId=l1')
    expect(within(dialog).getByRole('tab', { name: 'تلخيص درس' })).toHaveAttribute('aria-selected', 'true')
    expect(dialog).toHaveTextContent('الجمع ضمّ عددين.')
    expect(dialog).toHaveTextContent('ابدأ بالآحاد')
    expect(dialog).toHaveTextContent('المجموع')
    expect(dialog).toHaveTextContent('3 أسئلة')
    expect(within(dialog).getByRole('link', { name: 'افتح الدرس' })).toHaveAttribute('href', '/student/lessons/l1')

    fireEvent.click(within(dialog).getByRole('button', { name: 'دروس أخرى' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'الجمع' }))
    await advance(0)
    expect(fetchMock.mock.calls.filter(c => String(c[0]).includes('/summary'))).toHaveLength(1)
  })

  it('says so when a summary cannot be prepared', async () => {
    fetchMock.mockImplementation((url: string) => url.includes('/briefing')
      ? respond({ nudges: NUDGES, plan: PLAN, lessons: LESSONS })
      : respond({ error: 'forbidden' }, false))
    await mountReady()
    fireEvent.click(screen.getByRole('button', { name: 'افتح المساعد الدراسي' }))
    fireEvent.click(screen.getByRole('tab', { name: 'تلخيص درس' }))
    fireEvent.click(screen.getByRole('button', { name: 'الطرح' }))
    await advance(0)
    expect(screen.getByRole('dialog')).toHaveTextContent('تعذّر تجهيز الملخص')
  })

  it('keeps free questions closed until a provider is approved, and never calls it', async () => {
    await mountReady(false)
    fireEvent.click(screen.getByRole('button', { name: 'افتح المساعد الدراسي' }))
    fireEvent.click(screen.getByRole('tab', { name: 'اسأل' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('الأسئلة الحرة متوقفة مؤقتًا')
    expect(within(dialog).queryByRole('textbox')).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'لخّص درسًا' }))
    expect(within(dialog).getByRole('tab', { name: 'تلخيص درس' })).toHaveAttribute('aria-selected', 'true')
    expect(fetchMock.mock.calls.some(c => c[0] === '/api/assistant/student')).toBe(false)
  })

  it('offers the chat when a provider is approved', async () => {
    await mountReady(true)
    fireEvent.click(screen.getByRole('button', { name: 'افتح المساعد الدراسي' }))
    fireEvent.click(screen.getByRole('tab', { name: 'اسأل' }))
    expect(within(screen.getByRole('dialog')).getAllByRole('textbox').length).toBeGreaterThan(0)
  })
})
