// ── Assistant context bundle ─────────────────────────────────────
// Runs every source through its policy and returns one bundle for the model.
// Fail closed: if any source is refused, the whole bundle is refused and no
// partial output is returned. Pure function, no I/O.

import { sanitizeLessonForAssistant, pickExamMetaForAssistant, type AssistantExamMeta, type PolicyRefusal } from './context-policy'

export type AssistantSource =
  | { kind: 'lesson'; content: string }
  | { kind: 'exam'; row: Record<string, unknown> }

export type AssistantContextItem =
  | { kind: 'lesson'; text: string }
  | { kind: 'exam'; meta: AssistantExamMeta }

export type AssistantContextResult =
  | { ok: true; items: AssistantContextItem[] }
  | { ok: false; reason: PolicyRefusal; index: number }

export function buildAssistantContext(sources: AssistantSource[]): AssistantContextResult {
  const items: AssistantContextItem[] = []

  for (const [index, source] of sources.entries()) {
    if (source.kind === 'lesson') {
      const r = sanitizeLessonForAssistant(source.content)
      if (!r.ok) return { ok: false, reason: r.reason, index }
      items.push({ kind: 'lesson', text: r.text })
      continue
    }

    const r = pickExamMetaForAssistant(source.row)
    if (!r.ok) return { ok: false, reason: r.reason, index }
    items.push({ kind: 'exam', meta: r.value })
  }

  return { ok: true, items }
}
