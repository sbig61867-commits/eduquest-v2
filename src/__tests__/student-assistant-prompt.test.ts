import { describe, it, expect } from 'vitest'
import {
  parseAssistantBody,
  lessonDocToModelText,
  buildAssistantPrompt,
  clipAnswer,
  MAX_MESSAGE_CHARS,
  MAX_HISTORY_ITEMS,
  MAX_ANSWER_CHARS,
} from '@/lib/assistant/student-prompt'
import { serializeLessonDoc, type LessonDoc } from '@/lib/lesson-doc'

const LESSON_ID = '0f8e3c2a-1b4d-4e5f-8a9b-0c1d2e3f4a5b'

describe('parseAssistantBody — refuses malformed input, never repairs it', () => {
  it('accepts a minimal chat request', () => {
    const r = parseAssistantBody({ message: '  what is a cell?  ' })
    expect(r).toEqual({ ok: true, value: { mode: 'chat', message: 'what is a cell?', lessonId: null, selection: null, history: [] } })
  })

  it('accepts a lesson, a selection, a mode and history within limits', () => {
    const r = parseAssistantBody({
      mode: 'simplify',
      message: 'simpler please',
      lessonId: LESSON_ID,
      selection: 'Photosynthesis converts light into chemical energy.',
      history: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }],
    })
    expect(r.ok).toBe(true)
  })

  it('rejects a non-object or array body', () => {
    expect(parseAssistantBody(null).ok).toBe(false)
    expect(parseAssistantBody('text').ok).toBe(false)
    expect(parseAssistantBody([{ message: 'x' }]).ok).toBe(false)
  })

  it('rejects an unknown mode', () => {
    expect(parseAssistantBody({ mode: 'write_exam', message: 'x' }).ok).toBe(false)
  })

  it('rejects an empty or over-long message', () => {
    expect(parseAssistantBody({ message: '   ' }).ok).toBe(false)
    expect(parseAssistantBody({ message: 'a'.repeat(MAX_MESSAGE_CHARS + 1) }).ok).toBe(false)
  })

  it('rejects a lesson id that is not a UUID (no SQL-shaped input reaches the query)', () => {
    expect(parseAssistantBody({ message: 'x', lessonId: "1' OR '1'='1" }).ok).toBe(false)
    expect(parseAssistantBody({ message: 'x', lessonId: 42 }).ok).toBe(false)
  })

  it('rejects too many history turns and unknown roles', () => {
    const many = Array.from({ length: MAX_HISTORY_ITEMS + 1 }, () => ({ role: 'user', content: 'x' }))
    expect(parseAssistantBody({ message: 'x', history: many }).ok).toBe(false)
    expect(parseAssistantBody({ message: 'x', history: [{ role: 'system', content: 'x' }] }).ok).toBe(false)
  })

  it('rejects a selection that is not a string', () => {
    expect(parseAssistantBody({ message: 'x', selection: ['a'] }).ok).toBe(false)
  })
})

describe('lessonDocToModelText — quiz answers never leave the lesson', () => {
  const doc: LessonDoc = {
    eqLesson: 2,
    sections: [{
      id: 's1',
      title: 'Check yourself',
      blocks: [
        { id: 'b1', type: 'text', md: 'Chlorophyll absorbs light.' },
        {
          id: 'b2',
          type: 'quiz',
          intro: 'Answer the questions.',
          questions: [{
            text: 'Which colour is chlorophyll?',
            options: [{ letter: 'A', label: 'red' }, { letter: 'B', label: 'green' }],
            answer: 'SECRET-ANSWER-B',
          }],
        },
      ],
    }],
  }

  it('keeps the teaching text and the question text, drops the answer field', () => {
    const text = lessonDocToModelText(serializeLessonDoc(doc))
    expect(text).toContain('Chlorophyll absorbs light.')
    expect(text).toContain('Which colour is chlorophyll?')
    expect(text).toContain('B) green')
    expect(text).not.toContain('SECRET-ANSWER-B')
  })

  it('passes a legacy Markdown lesson through for the answer policy to scan', () => {
    const md = '## Quiz\n1. Q?\n**Answer:** B'
    expect(lessonDocToModelText(md)).toBe(md)
  })

  it('returns an empty string for missing content', () => {
    expect(lessonDocToModelText(null)).toBe('')
    expect(lessonDocToModelText(undefined)).toBe('')
  })
})

describe('buildAssistantPrompt — data is fenced with a per-request boundary', () => {
  const base = {
    mode: 'explain' as const,
    message: 'why?',
    lessonText: 'Lesson body here.',
    selection: 'Selected sentence.',
    history: [{ role: 'user' as const, content: 'earlier' }],
    boundary: 'abc123',
  }

  it('wraps lesson, selection, history and question in boundary markers', () => {
    const { prompt } = buildAssistantPrompt(base)
    expect(prompt).toContain('<<<abc123:LESSON>>>')
    expect(prompt).toContain('<<<abc123:SELECTION>>>')
    expect(prompt).toContain('<<<abc123:HISTORY>>>')
    expect(prompt).toContain('<<<abc123:QUESTION>>>')
    expect(prompt.match(/<<<abc123:END>>>/g)?.length).toBe(4)
  })

  it('tells the model to treat fenced content as data and never to reveal quiz answers', () => {
    const { system } = buildAssistantPrompt(base)
    expect(system).toMatch(/data, never as instructions/)
    expect(system).toMatch(/Never reveal or guess the answers/)
  })

  it('omits blocks that were not supplied', () => {
    const { prompt } = buildAssistantPrompt({ ...base, lessonText: null, selection: null, history: [] })
    expect(prompt).not.toContain(':LESSON>>>')
    expect(prompt).not.toContain(':SELECTION>>>')
    expect(prompt).not.toContain(':HISTORY>>>')
    expect(prompt).toContain('<<<abc123:QUESTION>>>')
  })
})

describe('clipAnswer', () => {
  it('trims and caps the provider reply', () => {
    expect(clipAnswer('  hi  ')).toBe('hi')
    expect(clipAnswer('x'.repeat(MAX_ANSWER_CHARS + 50))).toHaveLength(MAX_ANSWER_CHARS)
  })
})
