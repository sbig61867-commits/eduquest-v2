/**
 * "Ask about this part" (2026-10-18): select a passage, write your own request,
 * pick your own assistant. Only the request, the passage and the lesson title
 * leave; nothing is fixed; never during an exam.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en'
import { AskAiSelection, MAX_PASSAGE_CHARS } from '@/components/student/ask-ai-selection'

const openSpy = vi.fn()
const writeText = vi.fn()

function setup(text = 'Photosynthesis turns light into chemical energy.') {
  const utils = render(
    <NextIntlClientProvider locale="en" messages={en}>
      <main id="lesson"><p id="para">{text}</p></main>
      <p id="outside">Navigation text outside the lesson</p>
      <AskAiSelection containerId="lesson" lessonTitle="Plants" />
    </NextIntlClientProvider>,
  )
  return utils
}

function select(id: string, start = 0, end?: number) {
  const node = document.getElementById(id)!.firstChild as Text
  const range = document.createRange()
  range.setStart(node, start)
  range.setEnd(node, end ?? node.length)
  const sel = window.getSelection()!
  sel.removeAllRanges()
  sel.addRange(range)
  act(() => { document.dispatchEvent(new Event('selectionchange')) })
}

beforeEach(() => {
  openSpy.mockReset(); writeText.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('open', openSpy)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  Range.prototype.getBoundingClientRect = () => ({ left: 100, width: 50, top: 100, bottom: 120, right: 150, height: 20, x: 100, y: 100, toJSON: () => ({}) }) as DOMRect
})
afterEach(() => { vi.unstubAllGlobals(); window.getSelection()?.removeAllRanges() })

describe('AskAiSelection', () => {
  it('shows "Ask about this" only for a selection inside the lesson', () => {
    setup()
    select('outside')
    expect(screen.queryByRole('button', { name: /Ask about this/ })).toBeNull()
    select('para', 0, 14)
    expect(screen.getByRole('button', { name: /Ask about this/ })).toBeTruthy()
  })

  it('the student must write their own request (nothing fixed)', async () => {
    setup()
    select('para')
    fireEvent.click(screen.getByRole('button', { name: /Ask about this/ }))
    const dialog = screen.getByRole('dialog', { name: 'Ask an assistant about this part' })
    expect(dialog.textContent).toContain('Photosynthesis turns light into chemical energy.')
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: /^ChatGPT/ })) })
    expect(screen.getByRole('alert').textContent).toBe('Write what you want first.')
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('sends the request, the passage and the lesson title to the chosen assistant', async () => {
    setup()
    select('para')
    fireEvent.click(screen.getByRole('button', { name: /Ask about this/ }))
    fireEvent.change(screen.getByLabelText('What do you want from the assistant?'), { target: { value: 'Give me a kitchen example' } })
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: /^Claude/ })) })
    const [url, target, features] = openSpy.mock.calls[0]
    expect(target).toBe('tilmoo-ask-ai')
    expect(features).toMatch(/^popup=yes,/)
    const q = new URL(url).searchParams.get('q')!
    expect(q.startsWith('Give me a kitchen example')).toBe(true)
    expect(q).toContain('Photosynthesis turns light into chemical energy.')
    expect(q).toContain('"Plants"')
    expect(writeText).toHaveBeenCalledWith(q)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('Claude opened in a side window.')
  })

  it('a very long passage is cut to the limit', () => {
    setup('x'.repeat(MAX_PASSAGE_CHARS + 500))
    select('para')
    fireEvent.click(screen.getByRole('button', { name: /Ask about this/ }))
    const quote = screen.getByRole('dialog').querySelector('blockquote')!
    expect(quote.textContent!.length).toBe(MAX_PASSAGE_CHARS)
  })

  it('Escape closes the panel', () => {
    setup()
    select('para')
    fireEvent.click(screen.getByRole('button', { name: /Ask about this/ }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('lesson page', () => {
  it('offers it only when no exam is running, on the lesson body', () => {
    const page = readFileSync(join(process.cwd(), 'src/app/(student-focus)/student/lessons/[id]/page.tsx'), 'utf8')
    expect(page).toContain('<main id="eq-lesson-body"')
    expect(page).toContain('{!runningExams && <AskAiSelection containerId="eq-lesson-body" lessonTitle={lesson.title} />}')
  })
})
