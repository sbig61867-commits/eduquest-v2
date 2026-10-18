// Pronunciation through the browser's own speech engine (free, no API).
// 2026-10-17: every Latin-script word was read as en-US, so French vocabulary
// came out in an English voice; no voice was chosen, so the browser used its
// most basic one; and cancel() right before speak() made Chrome stall. Now the
// language comes from the word and the lesson around it, the best installed
// voice for it is picked, and voices are loaded before the first tap.

export type SpeechLang = 'ar-SA' | 'fr-FR' | 'es-ES' | 'de-DE' | 'it-IT' | 'pt-BR' | 'tr-TR' | 'nl-NL' | 'en-US'

const ARABIC = /[؀-ۿ]/
const MARKERS: [SpeechLang, RegExp][] = [
  ['fr-FR', /[àâçèéêëîïôœùûüÿ]|\b(le|la|les|un|une|des|du|et|est|je|tu|il|elle|nous|vous|bonjour|merci|oui|non|avec|pour|dans|c'est|j'ai|qu'il)\b/i],
  ['es-ES', /[ñ¿¡áíóú]|\b(el|los|las|una|es|está|hola|gracias|por|para|con|qué|señor)\b/i],
  ['de-DE', /[äöüß]|\b(der|die|das|und|ist|ich|nicht|ein|eine|danke|hallo|mit|für)\b/i],
  ['tr-TR', /[ğışİ]|\b(ve|bir|bu|merhaba|teşekkür|evet|hayır|nasılsın|ben|sen)\b/i],
  ['pt-BR', /[ãõ]|\b(olá|obrigado|obrigada|não|você|muito|são|uma)\b/i],
  ['it-IT', /\b(il|gli|della|ciao|grazie|sono|questo|perché|buongiorno|anche)\b/i],
  ['nl-NL', /\b(het|een|van|dank|hallo|niet|goedemorgen|ik|jij|zijn|wij)\b/i],
]

/** The language of a lesson's Latin-script text, from how often each marks it. */
export function detectLessonLanguage(content: string): SpeechLang {
  let best: SpeechLang = 'en-US'
  let bestHits = 0
  for (const [lang, re] of MARKERS) {
    const hits = (content.match(new RegExp(re.source, 'gi')) ?? []).length
    if (hits > bestHits) { best = lang; bestHits = hits }
  }
  return bestHits >= 3 ? best : 'en-US'
}

/** One word or phrase: Arabic script → Arabic; its own markers; else the lesson's language. */
export function speechLangFor(text: string, lessonLang: SpeechLang = 'en-US'): SpeechLang {
  if (ARABIC.test(text)) return 'ar-SA'
  for (const [lang, re] of MARKERS) if (re.test(text)) return lang
  return lessonLang === 'ar-SA' ? 'en-US' : lessonLang
}

const QUALITY = /natural|neural|online|google|premium|enhanced|siri/i

/** The best installed voice for a language: same language, then a natural one. */
export function pickVoice(voices: readonly SpeechSynthesisVoice[], lang: SpeechLang): SpeechSynthesisVoice | null {
  const base = lang.slice(0, 2)
  const same = voices.filter(v => v.lang.replace('_', '-').toLowerCase().startsWith(base))
  if (same.length === 0) return null
  const score = (v: SpeechSynthesisVoice) =>
    (v.lang.replace('_', '-').toLowerCase() === lang.toLowerCase() ? 2 : 0) + (QUALITY.test(v.name) ? 4 : 0) + (v.default ? 1 : 0)
  return [...same].sort((a, b) => score(b) - score(a))[0]
}

let lessonLang: SpeechLang = 'en-US'
/** Set by the lesson view from the lesson's own text. */
export function setLessonSpeechLanguage(lang: SpeechLang) { lessonLang = lang }

/** Loads the voice list early so the first tap does not wait for it. */
export function warmUpSpeech() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  window.speechSynthesis.getVoices()
  window.speechSynthesis.addEventListener?.('voiceschanged', () => window.speechSynthesis.getVoices(), { once: true })
}

export function speak(text: string) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  const synth = window.speechSynthesis
  const lang = speechLangFor(text, lessonLang)
  const u = new SpeechSynthesisUtterance(text)
  u.lang = lang
  const voice = pickVoice(synth.getVoices(), lang)
  if (voice) u.voice = voice
  u.rate = 0.9
  // cancel() only when something is playing: cancel-then-speak stalls Chrome.
  if (synth.speaking || synth.pending) synth.cancel()
  synth.speak(u)
}
