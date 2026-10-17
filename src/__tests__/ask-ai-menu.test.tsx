/**
 * "Ask an AI about this lesson" (2026-10-17): the student's own assistant opens
 * in a pop-up with the question ready; a hint offers a normal window for 4 s.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NextIntlClientProvider } from 'next-intl'
import ar from '@/messages/ar'
import en from '@/messages/en'
import { ASK_AI_PROVIDERS, MAX_PREFILL_CHARS, askAiUrl, popupFeatures } from '@/lib/ask-ai'
import { AskAiMenu, HINT_MS } from '@/components/student/ask-ai-menu'

const byId = (id: string) => ASK_AI_PROVIDERS.find(p => p.id === id)!

describe('ask-ai helpers', () => {
  it('every provider is an https site', () => {
    for (const p of ASK_AI_PROVIDERS) expect(new URL(p.url).protocol).toBe('https:')
  })

  it('puts the question in the URL only where the site accepts it', () => {
    expect(askAiUrl(byId('chatgpt'), 'شرح الدرس')).toBe('https://chatgpt.com/?q=%D8%B4%D8%B1%D8%AD+%D8%A7%D9%84%D8%AF%D8%B1%D8%B3')
    expect(askAiUrl(byId('gemini'), 'x')).toBe('https://gemini.google.com/app')
  })

  it('a question too long for a URL is not put in it (it is still copied)', () => {
    expect(askAiUrl(byId('claude'), 'a'.repeat(MAX_PREFILL_CHARS + 1))).toBe('https://claude.ai/new')
  })

  it('the pop-up sits on the far side of the screen, narrow and full height', () => {
    expect(popupFeatures(1600, 900, false)).toBe('popup=yes,width=520,height=820,left=1080,top=0')
    expect(popupFeatures(1600, 900, true)).toBe('popup=yes,width=520,height=820,left=0,top=0')
  })
})

const openSpy = vi.fn()
const writeText = vi.fn()
function renderIn(locale: 'ar' | 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'ar' ? ar : en}>
      <AskAiMenu lessonTitle="SQL Joins" groupName="Databases - A" />
    </NextIntlClientProvider>,
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  openSpy.mockReset(); writeText.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('open', openSpy)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  try { localStorage.clear() } catch { /* ignore */ }
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

async function pick(name: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Ask an AI' }))
  await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(`^${name}`) })) })
}

describe('AskAiMenu', () => {
  it('opens the chosen assistant in a pop-up with the lesson question, and copies it', async () => {
    renderIn('en')
    await pick('ChatGPT')
    const [url, target, features] = openSpy.mock.calls[0]
    expect(target).toBe('tilmoo-ask-ai')
    expect(features).toMatch(/^popup=yes,/)
    const q = new URL(url).searchParams.get('q')!
    expect(q).toContain('SQL Joins')
    expect(q).toContain('Databases - A')
    expect(writeText).toHaveBeenCalledWith(q)
  })

  it('the question carries the lesson title only, never its content', async () => {
    renderIn('en')
    await pick('Claude')
    const q = new URL(openSpy.mock.calls[0][0]).searchParams.get('q')!
    expect(q.length).toBeLessThan(400)
  })

  it('shows the "normal window" hint, then hides it after 4 seconds', async () => {
    renderIn('en')
    await pick('ChatGPT')
    expect(screen.getByRole('status').textContent).toContain('ChatGPT opened in a side window.')
    expect(screen.getByRole('button', { name: /Open in a normal window/ })).toBeTruthy()
    act(() => { vi.advanceTimersByTime(HINT_MS - 1) })
    expect(screen.queryByRole('status')).not.toBeNull()
    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.queryByRole('status')).toBeNull()
    expect(HINT_MS).toBe(4000)
  })

  it('"open in a normal window" opens a regular tab with the same address', async () => {
    renderIn('en')
    await pick('Perplexity')
    const popupUrl = openSpy.mock.calls[0][0]
    fireEvent.click(screen.getByRole('button', { name: /Open in a normal window/ }))
    expect(openSpy.mock.calls[1]).toEqual([popupUrl, '_blank', 'noopener'])
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('a site without prefill tells the student to paste', async () => {
    renderIn('en')
    await pick('Gemini')
    expect(openSpy.mock.calls[0][0]).toBe('https://gemini.google.com/app')
    expect(screen.getByRole('status').textContent).toContain('paste it there')
  })

  it('the chosen intent changes the question', async () => {
    renderIn('en')
    fireEvent.click(screen.getByRole('button', { name: 'Ask an AI' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Quiz me' }))
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: /^ChatGPT/ })) })
    expect(new URL(openSpy.mock.calls[0][0]).searchParams.get('q')).toContain('five short questions')
  })

  it('works in Arabic', async () => {
    renderIn('ar')
    fireEvent.click(screen.getByRole('button', { name: 'اسأل الذكاء الاصطناعي' }))
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: /^Claude/ })) })
    expect(new URL(openSpy.mock.calls[0][0]).searchParams.get('q')).toContain('«SQL Joins»')
    expect(screen.getByRole('button', { name: /افتحه في نافذة عادية/ })).toBeTruthy()
  })
})

describe('lesson page', () => {
  const page = readFileSync(join(process.cwd(), 'src/app/(student-focus)/student/lessons/[id]/page.tsx'), 'utf8')
  it('never offers the menu while the student has an exam running', () => {
    expect(page).toContain(".eq('status', 'in_progress')")
    expect(page).toContain(".eq('student_id', user.id)")
    expect(page).toContain('{!runningExams && <AskAiMenu')
  })
  it('passes the title and group only, not the lesson content', () => {
    expect(page).toMatch(/<AskAiMenu lessonTitle=\{lesson\.title\} groupName=\{group\?\.name\} \/>/)
  })
})
