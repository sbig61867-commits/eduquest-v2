import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LIMITS, markdownToLessonDoc, sanitizeLessonDoc } from '@/lib/lesson-doc'
import { TEMPLATES, templateBlock } from '@/lib/lesson-templates'
import { useLessonHistory } from '@/lib/use-lesson-history'
import en from '@/messages/en/common.json'

// The hybrid lesson editor's pieces (2026-10-18): templates are existing block
// types, generated lessons split into small blocks, and undo / redo / draft.

const tr = (k: string) => k.split('.').reduce<unknown>((o, p) => (o as Record<string, unknown>)?.[p], en.lessonBuilder.templates) as string

describe('lesson templates', () => {
  it('every template is a valid block the server keeps unchanged', () => {
    for (const key of TEMPLATES) {
      const block = templateBlock(key, tr)
      const doc = { eqLesson: 2 as const, sections: [{ id: 's1', title: '', blocks: [block] }] }
      const clean = sanitizeLessonDoc(doc)
      expect(clean?.sections[0].blocks[0].type, key).toBe(block.type)
    }
  })

  it('starter text comes from the messages, never undefined', () => {
    for (const key of TEMPLATES) expect(JSON.stringify(templateBlock(key, tr)), key).not.toContain('undefined')
  })

  it('maps the coloured templates onto callout tones', () => {
    const tone = (k: (typeof TEMPLATES)[number]) => { const b = templateBlock(k, tr); return b.type === 'callout' ? b.tone : null }
    expect([tone('definition'), tone('example'), tone('rule'), tone('warning')]).toEqual(['info', 'tip', 'remember', 'warning'])
  })
})

describe('generated lessons split into small blocks', () => {
  it('each paragraph is its own block and a heading stays with its paragraph', () => {
    const doc = markdownToLessonDoc('## Part\n\n### Heading\n\nFirst paragraph.\n\nSecond paragraph.\n\n- a\n- b')
    const mds = doc.sections[0].blocks.map(b => (b.type === 'text' ? b.md : b.type))
    expect(mds).toEqual(['### Heading\n\nFirst paragraph.', 'Second paragraph.', '- a\n- b'])
  })

  it('stays within the block limit by rejoining text', () => {
    const body = Array.from({ length: LIMITS.blocks + 25 }, (_, i) => `Paragraph ${i}.`).join('\n\n')
    const blocks = markdownToLessonDoc(`## Part\n\n${body}`).sections[0].blocks
    expect(blocks.length).toBeLessThanOrEqual(LIMITS.blocks)
    const all = blocks.map(b => (b.type === 'text' ? b.md : '')).join('\n\n')
    expect(all).toContain('Paragraph 0.')
    expect(all).toContain(`Paragraph ${LIMITS.blocks + 24}.`)
  })
})

describe('useLessonHistory', () => {
  beforeEach(() => { vi.useFakeTimers(); localStorage.clear() })
  afterEach(() => { vi.useRealTimers() })
  const open = (initial = 'a', base = 'saved') => renderHook(() => useLessonHistory(initial, { lessonId: 'L1', base }))

  it('undoes and redoes separate steps', () => {
    const { result } = open()
    act(() => result.current.set('b'))
    act(() => { vi.advanceTimersByTime(1000); result.current.set('c') })
    expect(result.current.value).toBe('c')
    act(() => result.current.undo())
    expect(result.current.value).toBe('b')
    act(() => result.current.undo())
    expect(result.current.value).toBe('a')
    expect(result.current.canUndo).toBe(false)
    act(() => result.current.redo())
    expect(result.current.value).toBe('b')
    expect(result.current.canRedo).toBe(true)
  })

  it('folds quick typing into one step', () => {
    const { result } = open()
    act(() => { result.current.set('ab'); result.current.set('abc'); result.current.set('abcd') })
    act(() => result.current.undo())
    expect(result.current.value).toBe('a')
  })

  it('a new change clears redo', () => {
    const { result } = open()
    act(() => result.current.set('b'))
    act(() => result.current.undo())
    act(() => result.current.set('z'))
    expect(result.current.canRedo).toBe(false)
  })

  it('keeps a draft and offers it back while the saved lesson is unchanged', () => {
    const first = open()
    act(() => first.result.current.set('edited'))
    act(() => { vi.advanceTimersByTime(1100) })
    first.unmount()
    const again = open()
    expect(again.result.current.draft?.value).toBe('edited')
    act(() => again.result.current.restoreDraft())
    expect(again.result.current.value).toBe('edited')
    expect(again.result.current.draft).toBeNull()
  })

  it('drops a draft based on an older saved lesson', () => {
    const first = open()
    act(() => first.result.current.set('edited'))
    act(() => { vi.advanceTimersByTime(1100) })
    first.unmount()
    expect(open('a', 'saved elsewhere since').result.current.draft).toBeNull()
    expect(localStorage.getItem('eq-lesson-draft:L1')).toBeNull()
  })

  it('a successful save clears the draft', () => {
    const { result } = open()
    act(() => result.current.set('edited'))
    act(() => { vi.advanceTimersByTime(1100) })
    expect(localStorage.getItem('eq-lesson-draft:L1')).not.toBeNull()
    act(() => result.current.markSaved())
    expect(localStorage.getItem('eq-lesson-draft:L1')).toBeNull()
  })
})
