import type { Locale } from '@/i18n/config'
import { aiText as ar } from './ar'
import { aiText as en } from './en'
import type { AiPromptText } from './types'

const TEXT: Record<Locale, AiPromptText> = { ar, en }

/** AI prompt text in `locale` — the viewer's language, so the model answers in it. */
export function aiPrompts(locale: Locale): AiPromptText {
  return TEXT[locale]
}

/**
 * Section names a generated lesson must end with, per source language. Shared
 * by the lesson prompts (src/content/ai/lesson-from-file.ts, src/lib/ai/chat.ts)
 * as worked examples for the model.
 */
export const QUIZ_SECTION_NAMES = {
  ar: { quiz: 'اختبر نفسك', test: 'اختبار شامل' },
  en: { quiz: 'Quick Quiz', test: 'Comprehensive Test' },
} as const
