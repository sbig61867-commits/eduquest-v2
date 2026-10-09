import { describe, it, expect } from 'vitest'
import { buildLessonPrompt } from '@/lib/ai/chat'

// The topic-based generator used to emit a bare 5-line English prompt: an
// Arabic topic came back as an English lesson, with no `##` headings (so the
// viewer rendered one flat wall instead of tabs) and prose "practice
// questions" the quiz parser could not read. These assertions pin the
// contract that lesson-tabs.tsx actually parses. Live-verified against Groq
// 2026-09-19: an Arabic topic returned 5 Arabic H2 tabs and a readable quiz.
describe('buildLessonPrompt', () => {
  it('pins the topic, the level and the language rule', () => {
    const p = buildLessonPrompt('البناء الضوئي', 'high school')
    expect(p).toContain('البناء الضوئي')
    expect(p).toContain('high school')
    expect(p).toMatch(/SAME language as the topic/i)
  })

  it('demands the H2 tab and quiz shape the viewer parses', () => {
    const p = buildLessonPrompt('Photosynthesis', 'undergraduate')
    expect(p).toContain('## Section Name')
    expect(p).toContain('### <the question text>')
    expect(p).toContain('- A) <option>')
    expect(p).toContain('Answer: B')
  })

  it('lets custom instructions override the default sections but never the quiz', () => {
    const p = buildLessonPrompt('Idioms', 'beginner', 'Only grammar rule and examples')
    expect(p).toContain('Only grammar rule and examples')
    expect(p).not.toContain('Learning Objectives')
    expect(p).toMatch(/QUIZ \(mandatory/)
  })
})

describe('buildLessonFromFilePrompt', async () => {
  const { buildLessonFromFilePrompt } = await import('@/content/ai/lesson-from-file')
  it('asks for the whole source, a teaching structure and the interactive blocks', () => {
    const p = buildLessonFromFilePrompt('SOURCE TEXT', 'undergraduate', '', ['mcq'])
    expect(p).toContain('SOURCE TEXT')
    expect(p).toMatch(/COMPLETENESS: this is NOT a summary/)
    expect(p).toContain('ONE content section per major topic')
    expect(p).toContain('```mindmap')
    expect(p).toContain('```steps')
    expect(p).toContain('- **term** — short definition')
    expect(p).not.toContain('choose 2-4')
  })
  it('later parts of a long file do not repeat the mind map instructions', () => {
    const p = buildLessonFromFilePrompt('x', 'undergraduate', '', ['mcq'], { index: 1, total: 3 })
    expect(p).not.toContain('```mindmap')
  })
})
