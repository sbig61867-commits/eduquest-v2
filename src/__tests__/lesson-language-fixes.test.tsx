/**
 * Four fixes from an AI-generated French lesson for kindergarten (2026-10-17):
 * each line aligns by its own language, pronunciation uses Arabic letters,
 * vocabulary is spoken in the lesson's language with a chosen voice, and the
 * lesson shows one section at a time.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en'
import { Markdown } from '@/components/shared/markdown'
import { normalizeTransliterations } from '@/lib/ai/arabic-transliteration'
import { detectLessonLanguage, pickVoice, speak, speechLangFor, setLessonSpeechLanguage } from '@/lib/speech'
import { buildLessonPrompt } from '@/lib/ai/chat'
import { LessonView } from '@/components/lesson/lesson-view'
import type { ComponentProps } from 'react'

type LessonDoc = NonNullable<ComponentProps<typeof LessonView>['doc']>

const ZHE = 'ژ', JEEM = 'ج', PE = 'پ', BEH = 'ب'
const AR = (s: string) => s // readability marker for Arabic sample text below

describe('Markdown: every line aligns by its own language', () => {
  it('paragraphs, list items, headings and quotes carry dir="auto"', () => {
    const { container } = render(<Markdown content={'# Les couleurs\n\nBonjour !\n\n- Rouge\n- ' + AR('أحمر') + '\n\n> Merci'} />)
    for (const sel of ['h1', 'p', 'li', 'blockquote']) {
      const els = [...container.querySelectorAll(sel)]
      expect(els.length, sel).toBeGreaterThan(0)
      for (const el of els) expect(el.getAttribute('dir'), sel).toBe('auto')
    }
  })

  it('table cells too', () => {
    const { container } = render(<Markdown content={'| FR | AR |\n|---|---|\n| Rouge | أحمر |'} />)
    for (const el of container.querySelectorAll('th, td')) expect(el.getAttribute('dir')).toBe('auto')
  })
})

describe('pronunciation in Arabic letters', () => {
  it('replaces Persian letters only inside the parentheses after a Latin word', () => {
    expect(normalizeTransliterations(`Rouge (رو${ZHE})`)).toBe(`Rouge (رو${JEEM})`)
    expect(normalizeTransliterations(`Pomme (${PE}وم)`)).toBe(`Pomme (${BEH}وم)`)
  })

  it('leaves text outside such parentheses untouched (a Persian lesson keeps its letters)', () => {
    const persian = `من ${ZHE}${PE} (${ZHE})`
    expect(normalizeTransliterations(persian)).toBe(persian)
    expect(normalizeTransliterations('Bonjour (bon-jour)')).toBe('Bonjour (bon-jour)')
  })

  it('handles several words in one text', () => {
    const out = normalizeTransliterations(`Rouge (رو${ZHE}) et Jaune (${ZHE}ون)`)
    expect(out).not.toContain(ZHE)
  })

  it('the topic prompt tells the model to use Arabic letters for pronunciation', () => {
    expect(buildLessonPrompt('French for kindergarten', 'beginner')).toMatch(/ONLY standard Arabic letters[\s\S]*jeem/)
  })
})

describe('speech language and voice', () => {
  const frLesson = 'Bonjour ! Le rouge, la pomme, les couleurs et je dis merci. C\'est jolie.'
  it('detects the lesson language from its text', () => {
    expect(detectLessonLanguage(frLesson)).toBe('fr-FR')
    expect(detectLessonLanguage('The cat is on the mat. I like apples and bananas.')).toBe('en-US')
  })

  it('a plain word ("Rouge") is spoken in the lesson language, not English', () => {
    expect(speechLangFor('Rouge', 'fr-FR')).toBe('fr-FR')
    expect(speechLangFor('Rouge')).toBe('en-US')
    expect(speechLangFor('أحمر', 'fr-FR')).toBe('ar-SA')
    expect(speechLangFor('el perro', 'fr-FR')).toBe('es-ES')
  })

  it('prefers a natural voice of the same language', () => {
    const v = (name: string, lang: string, d = false) => ({ name, lang, default: d, localService: true, voiceURI: name }) as SpeechSynthesisVoice
    const voices = [v('Microsoft David', 'en-US', true), v('Microsoft Hortense', 'fr-FR'), v('Google français', 'fr-FR'), v('Thomas', 'fr-CA')]
    expect(pickVoice(voices, 'fr-FR')?.name).toBe('Google français')
    expect(pickVoice(voices, 'de-DE')).toBeNull()
  })

  describe('speak()', () => {
    const speakSpy = vi.fn(), cancel = vi.fn()
    let speaking = false
    beforeEach(() => {
      speakSpy.mockReset(); cancel.mockReset(); speaking = false
      vi.stubGlobal('SpeechSynthesisUtterance', class { lang = ''; voice: unknown = null; rate = 1; constructor(public text: string) {} })
      vi.stubGlobal('speechSynthesis', {
        get speaking() { return speaking }, pending: false, cancel, speak: speakSpy,
        getVoices: () => [{ name: 'Google français', lang: 'fr-FR', default: false }],
      })
    })
    afterEach(() => vi.unstubAllGlobals())

    it('speaks French words with the French voice', () => {
      setLessonSpeechLanguage('fr-FR')
      speak('Rouge')
      const u = speakSpy.mock.calls[0][0]
      expect(u.lang).toBe('fr-FR')
      expect(u.voice?.name).toBe('Google français')
    })

    it('does not cancel when nothing is playing (cancel-then-speak stalls Chrome)', () => {
      speak('Rouge')
      expect(cancel).not.toHaveBeenCalled()
      speaking = true
      speak('Vert')
      expect(cancel).toHaveBeenCalledTimes(1)
    })
  })
})

describe('LessonView: one section at a time', () => {
  const doc = {
    version: 1, sections: [
      { id: 's1', title: 'Objectifs', blocks: [{ id: 'b1', type: 'text', md: 'Apprendre les couleurs.' }] },
      { id: 's2', title: 'Introduction', blocks: [{ id: 'b2', type: 'text', md: 'Le rouge et le bleu.' }] },
      { id: 's3', title: 'Quiz', blocks: [{ id: 'b3', type: 'text', md: 'Quelle couleur ?' }] },
    ],
  }
  const show = () => render(
    <NextIntlClientProvider locale="en" messages={en}>
      <LessonView doc={doc as unknown as LessonDoc} title="Les couleurs" />
    </NextIntlClientProvider>,
  )
  beforeEach(() => { try { localStorage.clear() } catch { /* ignore */ } ; Element.prototype.scrollIntoView = vi.fn() })

  it('shows only the current section, and Next / Previous move between them', () => {
    show()
    expect(screen.getByText('Apprendre les couleurs.')).toBeTruthy()
    expect(screen.queryByText('Le rouge et le bleu.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Next: Introduction/ }))
    expect(screen.queryByText('Apprendre les couleurs.')).toBeNull()
    expect(screen.getByText('Le rouge et le bleu.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Previous: Objectifs/ }))
    expect(screen.getByText('Apprendre les couleurs.')).toBeTruthy()
  })

  it('the side list jumps straight to a section', () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: /^3?\s*Quiz$/ }))
    expect(screen.getByText('Quelle couleur ?')).toBeTruthy()
    expect(screen.queryByText('Apprendre les couleurs.')).toBeNull()
  })

  it('"Whole lesson" shows every section and is remembered', () => {
    show()
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Whole lesson' })) })
    for (const text of ['Apprendre les couleurs.', 'Le rouge et le bleu.', 'Quelle couleur ?']) expect(screen.getByText(text)).toBeTruthy()
    expect(localStorage.getItem('eq-lesson-view-all')).toBe('1')
    expect(screen.getByRole('button', { name: 'One section at a time' })).toBeTruthy()
  })
})

describe('everywhere (follow-up 2026-10-18)', () => {
  it('every AI route that writes learning content applies the letter fix', async () => {
    const { readFileSync } = await import('node:fs')
    for (const r of ['ai/generate-lesson', 'ai/generate-lesson-from-file', 'courses/generate-item-content',
      'ai/generate-exam', 'ai/generate-homework-from-file', 'ai/individual-task']) {
      expect(readFileSync(`src/app/api/${r}/route.ts`, 'utf8'), r).toMatch(/normalizeTransliterations(Deep)?\(/)
    }
  })

  it('the deep fix reaches every string, and keeps an answer equal to its option', async () => {
    const { normalizeTransliterationsDeep } = await import('@/lib/ai/arabic-transliteration')
    const q = { text: `Rouge (\u0631\u0648${ZHE})?`, options: [`Rouge (\u0631\u0648${ZHE})`, 'Vert'], correct_answer: `Rouge (\u0631\u0648${ZHE})`, points: 2 }
    const out = normalizeTransliterationsDeep(q)
    expect(JSON.stringify(out)).not.toContain(ZHE)
    expect(out.options[0]).toBe(out.correct_answer)
    expect(out.points).toBe(2)
  })

  it('lessons generated before the fix are corrected when shown', () => {
    const { container } = render(<Markdown content={`- Rouge (\u0631\u0648${ZHE})`} />)
    expect(container.textContent).toContain(`\u0631\u0648${JEEM}`)
    expect(container.textContent).not.toContain(ZHE)
  })

  it('more lesson languages are recognised for pronunciation', () => {
    expect(detectLessonLanguage('Ciao! Grazie, questo è il libro. Buongiorno anche a te, sono qui.')).toBe('it-IT')
    expect(detectLessonLanguage('Olá! Obrigado, você é muito gentil. Não, são duas.')).toBe('pt-BR')
    expect(detectLessonLanguage('Merhaba! Teşekkür ederim, evet bu bir kitap ve ben okuyorum.')).toBe('tr-TR')
    expect(detectLessonLanguage('Hallo! Dank je, ik ben het niet, wij zijn van hier.')).toBe('nl-NL')
  })

  it('a link in an English lesson does not make it Portuguese', () => {
    expect(detectLessonLanguage('Visit example.com and google.com, then read the text at site.com today.')).toBe('en-US')
  })
})
