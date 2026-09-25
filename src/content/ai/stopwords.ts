// Language data for the grounding check in /api/ai/generate-homework-from-file:
// a generated question must share distinctive words with the source, so the
// commonest function words of each supported language are ignored first.
// Adding a language = add its words here (and its punctuation below).

export const STOPWORDS: ReadonlySet<string> = new Set([
  // English
  'this', 'that', 'these', 'those', 'with', 'from', 'what', 'which', 'when',
  'where', 'true', 'false', 'about', 'have', 'their', 'there', 'would',
  'could', 'should', 'into', 'your', 'they', 'them', 'then', 'than',
  // Arabic
  'هذا', 'هذه', 'ذلك', 'التي', 'الذي', 'الذين', 'كان', 'كانت', 'وهو',
  'وهي', 'على', 'الى', 'إلى', 'من', 'في', 'عن', 'مع', 'بين', 'كل',
])

/** Punctuation stripped before comparing two questions (Latin + Arabic ؟ ، ـ). */
export const QUESTION_PUNCTUATION = /[.,!؟?،:'"()\-ــ_]/g
