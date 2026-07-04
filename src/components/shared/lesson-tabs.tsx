'use client'

import { useState } from 'react'
import { Markdown } from '@/components/shared/markdown'
import { CheckCircle2, XCircle, RotateCcw } from 'lucide-react'

// Renders lesson Markdown as tabs, one per top-level `## ` section.
// Sections whose body contains structured questions (### Qn blocks with an
// **Answer:** line — the format the lesson generator emits) become an
// interactive quiz the student answers in place; other sections render as
// plain Markdown. Content with <2 sections falls back to one Markdown page.

interface Section { title: string; body: string }

function splitSections(content: string): { preamble: string; sections: Section[] } {
  const lines = content.split('\n')
  const sections: Section[] = []
  const preamble: string[] = []
  let current: Section | null = null
  let inCode = false

  for (const line of lines) {
    if (/^```/.test(line.trim())) inCode = !inCode
    const m = !inCode && line.match(/^##\s+(.+)$/)
    if (m) {
      if (current) sections.push(current)
      current = { title: m[1].replace(/[#*_`]/g, '').trim(), body: '' }
    } else if (current) {
      current.body += line + '\n'
    } else {
      preamble.push(line)
    }
  }
  if (current) sections.push(current)
  return { preamble: preamble.join('\n').trim(), sections }
}

// ── Quiz parsing ─────────────────────────────────────────────────

interface QuizQuestion {
  text: string
  options: { letter: string; label: string }[] // empty → fill-in-the-blank
  answer: string
}

const ANSWER_RE = /^(?:\*\*)?\s*(?:Answer|الإجابة|الاجابة|الجواب)\s*(?:\*\*)?\s*[::]\s*(?:\*\*)?\s*(.+?)(?:\*\*)?\s*$/i
const OPTION_RE = /^[-*]?\s*(?:\*\*)?([A-Da-dأ-د])(?:\*\*)?[).\-–]\s+(.+)$/

function parseQuiz(body: string): { intro: string; questions: QuizQuestion[] } {
  const blocks = body.split(/^###\s+/m)
  const intro = blocks[0].trim()
  const questions: QuizQuestion[] = []

  for (const block of blocks.slice(1)) {
    const lines = block.split('\n')
    const textLines: string[] = []
    const options: { letter: string; label: string }[] = []
    let answer = ''

    for (let i = 1; i <= lines.length - 1; i++) {
      const line = lines[i]
      const ans = line.match(ANSWER_RE)
      if (ans) { answer = ans[1].trim(); continue }
      const opt = line.match(OPTION_RE)
      if (opt) { options.push({ letter: opt[1].toUpperCase(), label: opt[2].trim() }); continue }
      if (options.length === 0) textLines.push(line)
    }

    const text = textLines.join('\n').trim()
    if (text && answer) questions.push({ text, options, answer })
  }
  return { intro, questions }
}

function normalize(s: string): string {
  return s.trim().toLowerCase()
    .replace(/[.,!؟?،]/g, '')
    .replace(/\s+/g, ' ')
}

function isCorrect(q: QuizQuestion, given: string): boolean {
  if (!given) return false
  if (q.options.length > 0) {
    // The answer may be "B" or "B) some text" — compare on the letter.
    const letter = q.answer.match(/^([A-Da-dأ-د])\b/)?.[1]?.toUpperCase() ?? q.answer.toUpperCase()
    return given.toUpperCase() === letter
  }
  // Fill-in-the-blank: accept any variant separated by "/" or "أو".
  return q.answer.split(/\/|\bأو\b|\bor\b/i).some(a => normalize(a) === normalize(given))
}

// ── Interactive quiz section ─────────────────────────────────────

function InteractiveQuiz({ intro, questions }: { intro: string; questions: QuizQuestion[] }) {
  const [answers, setAnswers] = useState<Record<number, string>>({})
  const [checked, setChecked] = useState(false)

  const score = questions.reduce((n, q, i) => n + (isCorrect(q, answers[i] ?? '') ? 1 : 0), 0)
  const allAnswered = questions.every((_, i) => (answers[i] ?? '').trim() !== '')

  function reset() { setAnswers({}); setChecked(false) }

  return (
    <div className="space-y-5">
      {intro && <Markdown content={intro} />}

      {questions.map((q, i) => {
        const given = answers[i] ?? ''
        const correct = checked && isCorrect(q, given)
        const wrong = checked && !correct
        return (
          <div key={i} className={`rounded-xl border p-4 space-y-3 ${
            checked ? (correct ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-red-500/40 bg-red-500/5') : 'border-slate-700 bg-slate-800/40'
          }`}>
            <div className="flex items-start gap-2">
              <span className="shrink-0 w-6 h-6 rounded-full bg-slate-700 text-slate-200 text-xs font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
              <div className="flex-1 text-sm text-slate-200"><Markdown content={q.text} /></div>
              {checked && (correct
                ? <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                : <XCircle className="w-5 h-5 text-red-400 shrink-0" />)}
            </div>

            {q.options.length > 0 ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {q.options.map(opt => {
                  const selected = given === opt.letter
                  const answerLetter = q.answer.match(/^([A-Da-dأ-د])\b/)?.[1]?.toUpperCase() ?? q.answer.toUpperCase()
                  const isAnswer = checked && opt.letter === answerLetter
                  return (
                    <button
                      key={opt.letter}
                      disabled={checked}
                      onClick={() => setAnswers(a => ({ ...a, [i]: opt.letter }))}
                      className={`text-start px-3 py-2 rounded-lg border text-sm transition-colors disabled:cursor-default ${
                        isAnswer
                          ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300'
                          : selected
                            ? checked
                              ? 'border-red-500 bg-red-500/15 text-red-300'
                              : 'border-violet-500 bg-violet-500/15 text-white'
                            : 'border-slate-700 bg-slate-800/60 text-slate-300 hover:border-slate-500'
                      }`}
                    >
                      <span className="font-bold me-2">{opt.letter})</span>{opt.label}
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="space-y-1">
                <input
                  value={given}
                  disabled={checked}
                  onChange={e => setAnswers(a => ({ ...a, [i]: e.target.value }))}
                  placeholder="اكتب إجابتك هنا..."
                  dir="auto"
                  className={`w-full sm:w-80 px-3 py-2 rounded-lg border bg-slate-800/60 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500 ${
                    checked ? (correct ? 'border-emerald-500' : 'border-red-500') : 'border-slate-700'
                  }`}
                />
                {wrong && <p className="text-emerald-400 text-xs">الإجابة الصحيحة: {q.answer}</p>}
              </div>
            )}
          </div>
        )
      })}

      <div className="flex items-center gap-3 flex-wrap">
        {!checked ? (
          <button
            onClick={() => setChecked(true)}
            disabled={!allAnswered}
            className="px-5 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
          >
            تحقق من إجاباتي
          </button>
        ) : (
          <>
            <div className={`px-4 py-2 rounded-lg text-sm font-bold ${
              score === questions.length ? 'bg-emerald-500/15 text-emerald-400' : score >= questions.length / 2 ? 'bg-amber-500/15 text-amber-400' : 'bg-red-500/15 text-red-400'
            }`}>
              نتيجتك: {score} / {questions.length}
            </div>
            <button
              onClick={reset}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:text-white hover:border-slate-400 text-sm transition-colors"
            >
              <RotateCcw className="w-4 h-4" /> إعادة المحاولة
            </button>
          </>
        )}
        {!checked && !allAnswered && (
          <span className="text-slate-500 text-xs">أجب على كل الأسئلة أولاً</span>
        )}
      </div>
    </div>
  )
}

// ── Main tabs component ──────────────────────────────────────────

export function LessonTabs({ content }: { content: string }) {
  const { preamble, sections } = splitSections(content)
  const [active, setActive] = useState(0)

  if (sections.length < 2) return <Markdown content={content} />

  const section = sections[active]
  const quiz = parseQuiz(section.body)

  return (
    <div className="space-y-4">
      {preamble && <Markdown content={preamble} />}
      <div className="flex flex-wrap gap-2 border-b border-slate-700 pb-2" role="tablist">
        {sections.map((s, i) => (
          <button
            key={i}
            role="tab"
            aria-selected={i === active}
            onClick={() => setActive(i)}
            className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              i === active
                ? 'bg-violet-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'
            }`}
          >
            {s.title}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {quiz.questions.length > 0
          ? <InteractiveQuiz key={active} intro={quiz.intro} questions={quiz.questions} />
          : <Markdown content={section.body} />}
      </div>
    </div>
  )
}
