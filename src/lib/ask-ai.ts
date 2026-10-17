// "Ask an AI about this lesson" (2026-10-17). The student opens the AI
// assistant of their choice, signed in with their OWN account there; the
// platform pays nothing and calls no provider. We only build the question.
//
// Privacy: the question names the lesson (and its group), never the lesson's
// content, grades or answers. Content leaving the platform is an institution
// decision (src/lib/ai/privacy.ts); this feature does not make it.

export const ASK_AI_PROVIDERS = [
  // prefill: the site accepts the question in the URL (?q=). Unofficial
  // parameters that may change, so the question is ALWAYS copied as well.
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', param: 'q', prefill: true },
  { id: 'claude', name: 'Claude', url: 'https://claude.ai/new', param: 'q', prefill: true },
  { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/app', param: null, prefill: false },
  { id: 'perplexity', name: 'Perplexity', url: 'https://www.perplexity.ai/search', param: 'q', prefill: true },
  { id: 'grok', name: 'Grok', url: 'https://grok.com/', param: 'q', prefill: true },
  { id: 'copilot', name: 'Copilot', url: 'https://copilot.microsoft.com/', param: 'q', prefill: true },
  { id: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com/', param: null, prefill: false },
] as const

export type AskAiProvider = (typeof ASK_AI_PROVIDERS)[number]
export type AskAiIntent = 'explain' | 'quiz' | 'stuck'

/** Longest question we put in a URL; a longer one is still copied in full. */
export const MAX_PREFILL_CHARS = 1500

/** The URL that opens the provider, with the question when it accepts one. */
export function askAiUrl(provider: AskAiProvider, question: string): string {
  if (!provider.prefill || !provider.param || question.length > MAX_PREFILL_CHARS) return provider.url
  const u = new URL(provider.url)
  u.searchParams.set(provider.param, question)
  return u.toString()
}

/** Pop-up beside the platform: narrow, full height, on the screen's far side. */
export function popupFeatures(screenWidth: number, screenHeight: number, rtl: boolean): string {
  const width = Math.min(520, Math.max(360, Math.round(screenWidth * 0.36)))
  const height = Math.max(480, screenHeight - 80)
  const left = rtl ? 0 : Math.max(0, screenWidth - width)
  return `popup=yes,width=${width},height=${height},left=${left},top=0`
}

/** An attempt still running counts as "in an exam"; abandoned ones expire. */
export const ACTIVE_EXAM_WINDOW_HOURS = 12

/** Start of the window in which a running attempt still counts (ISO). */
export function activeExamSince(now: number = Date.now()): string {
  return new Date(now - ACTIVE_EXAM_WINDOW_HOURS * 3600_000).toISOString()
}
