// Prompt for /api/ai/generate-lesson-from-file.
//
// One prompt for every source language: the instructions are English, and the
// Arabic in it is deliberate — worked examples of the section names the model
// must produce for an Arabic source ("اختبر نفسك" / "اختبار شامل") and of the
// vocabulary line format, whose `||…||` part carries the Arabic translation.
//
// FORMAT CONTRACT: the vocabulary line `- **term** — explanation ||translation||`
// is parsed by VOCAB_RE in src/components/shared/lesson-tabs.tsx, which requires
// a dash (— – : -) after the bold term. Do not replace those dashes with commas:
// an earlier "remove dashes" sweep (commit 8c1ff22) did exactly that and the
// vocabulary pronunciation/translation widget stopped matching. Restored here
// from the version before that commit.

function questionTypesClause(qTypes: string[]): string {
  const LABEL: Record<string, string> = {
    true_false: 'true/false (options exactly: - A) True / - B) False)',
    mcq: 'multiple choice with 4 options',
    essay: 'open/essay questions (NO option lines; put a model answer after **Answer:**)',
  }
  return `In the quiz and test sections use ONLY these question types, chosen by the teacher: ${qTypes.map(t => LABEL[t]).join(' + ')}. Never use any other type.`
}

export function buildLessonFromFilePrompt(chunk: string, level: string, customInstructions: string, qTypes: string[], part?: { index: number; total: number }): string {
  const structureBlock = customInstructions.trim()
    ? `The teacher has provided specific instructions — follow them exactly (they OVERRIDE the default section choice; if the teacher names specific sections/tabs, use exactly those, in their order and language):
"""
${customInstructions}
"""
Platform format contract (applies regardless of the instructions above):
- Every section MUST start with a Markdown H2 heading (\`## Section Name\`) — each H2 renders as a separate tab. Use \`##\` ONLY for section boundaries.
- Keep exercises/questions out of content sections.
- The lesson MUST ALWAYS end with a quick-quiz section and a comprehensive-test section (named in the source language, e.g. "اختبر نفسك" / "اختبار شامل" for Arabic, "Quick Quiz" / "Comprehensive Test" for English) — these two tabs are mandatory for every subject and CANNOT be dropped, even if the teacher's section list doesn't mention them. The teacher's instructions control the QUESTION TYPES inside them (e.g. "أسئلة صح وخطأ فقط" → true/false only) but never their existence.
- If the teacher asks for a task/assignment section (مهمة), add a \`## Task\` tab (named in the source language, e.g. "المهمة") BEFORE the quiz sections, containing the assignment exactly as the teacher describes it.
- EVERY question MUST use this machine-readable format (it becomes an interactive quiz):

### Q1
Question text (use ________ for fill-in-the-blank)
- A) option
- B) option
**Answer:** B

Fill-in-the-blank questions have no option lines and the Answer is the exact missing word. Never put a combined "Answers" list at the end.
- In language lessons, vocabulary/idiom items use \`- **term** — simple English explanation ||الترجمة العربية||\` (explanation in simple English; Arabic ONLY inside ||...||, shown to the student on demand). If the source pairs words directly with Arabic, write your own simple English explanation and move the Arabic into ||...||. Infer category headings lost by PDF extraction (Kitchen, Bathroom, …) and render them as \`### Heading\` lines grouping their items.
- Examples in content sections are shown ALREADY SOLVED with the answer wrapped in ==double equals== (highlighted green), e.g. "There ==is== a car." — unsolved exercises belong in quiz sections only.`
    : `Organize the material into thematic sections. Each section MUST start with a Markdown H2 heading (\`## Section Name\`) — the platform renders every H2 section as a separate tab, so use \`##\` ONLY for section boundaries.

First detect the subject and the language of the source, then choose 2-4 content-section names that fit it. ALWAYS write every section name (including the two quiz sections below) in the SAME language as the source:
- Language-learning material: e.g. Vocabulary, Grammar, Idioms & Expressions, Examples.
  In Vocabulary and Idioms sections, write EVERY item on its own line EXACTLY as:
  \`- **term** — simple English explanation ||الترجمة العربية||\`
  (bold term, then a dash, then a SHORT explanation in simple English so the student learns through English, then the Arabic translation inside ||double pipes|| — the platform hides the Arabic behind a "ترجمة" button and adds a pronunciation button to the term. NEVER translate idioms into Arabic in the visible explanation; Arabic goes ONLY inside ||...||.)
  If the source is a word list that pairs each English word with its Arabic translation directly, do NOT show the Arabic as the explanation — WRITE YOUR OWN simple English explanation for the visible part and put the source's Arabic translation inside ||...||.
  The same applies to idioms: even if the source translates an idiom straight into Arabic, first explain it in simple English (English-to-simple-English), Arabic only inside ||...||.
  PDF extraction loses bold/colored formatting, so category headings (e.g. Kitchen, Bathroom, Rooms) arrive flattened into the word stream — infer them from meaning and render each as a \`### Heading\` line, grouping its related vocabulary items beneath it, in the source's order.
- Science / math / history / other: e.g. Key Concepts, Definitions, Explanations, Examples, Formulas, Laws.
Include a section only if the source actually has that kind of content, but always produce AT LEAST TWO content sections by splitting the material into logical parts — never collapse everything into a single content tab.

STRICT content-placement rules:
- Content sections contain ONLY explanations, rules, definitions, lists, and WORKED examples (with their solutions shown). A "rules"/"grammar"/"concepts" section must EXPLAIN each point and show example(s).
- Every example in content sections MUST be shown ALREADY SOLVED, with the answer wrapped in ==double equals== so the platform highlights it in green — e.g. "There ==is== a car in the garage." / "==Is there== a boy in the room?". Never leave a blank (________) unsolved in a content section.
- NO exercises, drills, fill-in-the-blanks, or questions of any kind in content sections. Every exercise or question found in the source MUST be moved into the quiz section instead.
- Do not omit source content and do not add facts that are not in the source.

Then ALWAYS end with exactly these two extra sections. Translate BOTH names into the source language — for an Arabic source they MUST be "اختبر نفسك" and "اختبار شامل"; for English keep "Quick Quiz" and "Comprehensive Test"; for any other language use the natural equivalent:
1. \`## <Quick Quiz in source language>\` — all exercises found in the source, plus short questions, totalling at least 5.
2. \`## <Comprehensive Test in source language>\` — 8-12 NEW questions covering ALL parts of the material (mix of multiple choice and fill-in-the-blank).

EVERY question in Quick Quiz and Comprehensive Test MUST use EXACTLY this machine-readable format (the platform turns it into an interactive quiz — deviating breaks it):

### Q1
Question text here (use ________ for fill-in-the-blank questions)
- A) first option
- B) second option
- C) third option
- D) fourth option
**Answer:** B

### Q2
Fill-in-the-blank question with ________ in it
**Answer:** the missing word

Rules for questions: multiple choice has 2-4 options and the Answer is the letter only. Fill-in-the-blank has NO option lines and the Answer is the exact missing word/phrase. Never put an "Answers" list at the end — each question carries its own **Answer:** line.`

  const continuationNote = part && part.index > 0
    ? `\nThis is part ${part.index + 1} of ${part.total} of one longer document, already in progress — continue directly with this part's content. Do not repeat a title or restart with an introduction. Only produce the Quick Quiz and Comprehensive Test sections if this is the FINAL part (part ${part.total} of ${part.total}), covering the whole document.`
    : ''

  return `You are converting a teacher's source material into a structured lesson page.
Preserve the source content faithfully — do not invent information that is not present in it (quiz/test questions must be answerable from the material alone).
Keep the same language as the source material.

Level: ${level}
${structureBlock}
${questionTypesClause(qTypes)}${continuationNote}

Format in Markdown.

Source content:
${chunk}`
}
