// ── Assistant matching patterns (Arabic and English) ─────────────
// Arabic text patterns live here, under src/content, because the i18n scan
// covers app/components/lib only. They match what a student or a lesson
// writes; they are never shown as UI text.

/** Answer labels in lesson or exam text (line is cut at the first match). */
export const ANSWER_LABEL_RE = /(?:\*\*)?\s*(?:answer|correct answer|model answer|الإجابة النموذجية|الإجابة|الاجابة|الجواب)\s*(?:\*\*)?\s*[:：\-–—]/i

/** Markers the policy does not interpret: refuse the content rather than guess. */
export const UNSUPPORTED_MARKER_RE = /(?:solution|hint|answer key|الحل|تلميح|المفتاح|الحل النموذجي)\s*(?:\*\*)?\s*[:：]/i

/** Words that ask about the student's account rather than a lesson. */
export const OVERVIEW_RE = /(ملخص|موجز|حسابي|وضعي|ماذا عندي|ما الجديد|جديد|مهام|مهمة|واجب|واجبات|امتحان|امتحانات|درج|علامات|اعلان|إعلان|summary|overview|my account|what'?s new|homework|assignment|exam|grade|announcement)/i

/** Normalisation for matching only (never for display). */
export const ARABIC_TATWEEL = /ـ/g
export const ARABIC_HARAKAT = /[ً-ٰٟ]/g
export const ARABIC_ALEF_VARIANTS = /[أإآ]/g
export const ARABIC_TA_MARBUTA = /ة/g

/** Arabic folding for matching: tatweel, harakat, alef variants, ta marbuta. */
export function foldArabic(s: string): string {
  return s
    .replace(ARABIC_TATWEEL, '')
    .replace(ARABIC_HARAKAT, '')
    .replace(ARABIC_ALEF_VARIANTS, 'ا')
    .replace(ARABIC_TA_MARBUTA, 'ه')
}
