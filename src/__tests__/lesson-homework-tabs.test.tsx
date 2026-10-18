import { fireEvent, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import en from '@/messages/en'
import { LessonHomeworkTabs, type LessonHomeworkItem } from '@/components/student/lesson-homework-tabs'

// The lesson's homework inside the lesson, as the teacher sees it (2026-10-18).

const item = (over: Partial<LessonHomeworkItem>): LessonHomeworkItem => ({
  id: 'h1', title: 'Past simple practice', instructions: null, question_count: 5, duration_minutes: 0,
  ends_at: null, assigned_to_me: false, has_manual_questions: false, submission: null, can_redo: false, ...over,
})

const mount = (homework: LessonHomeworkItem[]) => render(
  <NextIntlClientProvider locale="en" messages={en}>
    <LessonHomeworkTabs homework={homework}><p>Lesson body</p></LessonHomeworkTabs>
  </NextIntlClientProvider>,
)

describe('LessonHomeworkTabs', () => {
  it('opens on the content; the Homework tab counts what is still to do', () => {
    mount([item({}), item({ id: 'h2', submission: { score: null, max_score: 10, grading_status: 'pending' } })])
    expect(screen.getByText('Lesson body')).toBeVisible()
    expect(screen.getByRole('tab', { name: /Homework/ }).textContent).toContain('1')
  })

  it('lists the homework with a link that opens it on the exam screen', () => {
    mount([item({})])
    fireEvent.click(screen.getByRole('tab', { name: /Homework/ }))
    expect(screen.getByText('Past simple practice')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Start homework/ })).toHaveAttribute('href', '/student/exams?open=h1')
  })

  it('a submitted homework shows its state, the grade only once published, and no button', () => {
    mount([
      item({ id: 'a', title: 'Waiting', submission: { score: 4, max_score: 10, grading_status: 'pending' } }),
      item({ id: 'b', title: 'Graded', submission: { score: 8, max_score: 10, grading_status: 'published' } }),
    ])
    fireEvent.click(screen.getByRole('tab', { name: /Homework/ }))
    expect(screen.getByText(/has not published the grade yet/)).toBeTruthy()
    expect(screen.getByText('Your grade: 8 / 10')).toBeTruthy()
    expect(screen.queryByText('Your grade: 4 / 10')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('says so when the lesson has no homework', () => {
    mount([])
    fireEvent.click(screen.getByRole('tab', { name: /Homework/ }))
    expect(screen.getByText('There is no homework for this lesson.')).toBeTruthy()
  })
})

describe('student lesson page', () => {
  it('wraps the lesson in the tabs and reads only this lesson homework', () => {
    const page = readFileSync(join(process.cwd(), 'src/app/(student-focus)/student/lessons/[id]/page.tsx'), 'utf8')
    expect(page).toContain('<LessonHomeworkTabs homework={homework}>')
    expect(page).toContain("e.type === 'homework' && e.lesson_id === lesson.id")
  })
})
