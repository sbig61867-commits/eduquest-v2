// ── AI privacy approvals ─────────────────────────────────────────
// Which provider may receive which kind of content. Pure data and checks,
// no I/O. Having an API key is never approval: a provider receives content of
// an audience only when it is listed here as approved for that audience.
//
//   public       a short topic typed for a topic-only generator, fixed option values
//   institution  teacher files, free-text instructions, course source text,
//                announcement briefs, course analytics
//   personal     a student's own written answers, grades, groups or announcements
//
// Approvals are recorded per provider and audience below, with the owner's
// decision and the provider terms behind them.
//
// The check runs inside meterCall() (meter.ts), which every provider call goes
// through, so a call that forgets its audience is refused before any network I/O.

export type AiAudience = 'public' | 'institution' | 'personal'

const AUDIENCES: readonly AiAudience[] = ['public', 'institution', 'personal']

export const PRIVACY_APPROVALS: Readonly<Record<string, Readonly<Record<AiAudience, boolean>>>> = {
  // Owner decision 2026-10-18: teachers' AI features work again as before the gate
  // (lessons from files and instructions, course content, exams, homework,
  // announcements, improve-a-block). Institution content is approved for the whole
  // free chain. Known terms, recorded so the decision stays visible:
  //   cohere  trains on prompts unless opted out (enterprise only)
  //   gemini  unpaid quota may be used to improve Google products / human review
  //   xkiro, openrouter  no confirmed data terms for free routes
  //
  // Owner decision 2026-10-18: both ways stay open to students. With their own
  // account, the AI of their choice (src/lib/ask-ai.ts, free for them as usual);
  // or the platform's assistant on our free keys. Personal content goes to Groq
  // ONLY (no other provider in the chain), and only the question travels: every
  // personal text is passed through redactSensitive() (redact.ts) first, so names,
  // contact details, identifiers and links never leave, and account data
  // (grades, groups, announcements) is never sent at all (assistant/student route).
  groq:       { public: true, institution: true, personal: true },
  xkiro:      { public: true, institution: true, personal: false },
  cohere:     { public: true, institution: true, personal: false },
  gemini:     { public: true, institution: true, personal: false },
  openrouter: { public: true, institution: true, personal: false },
}

/** Thrown when content would have to go to a provider that is not approved for it. */
export class PrivacyPendingError extends Error {
  constructor(public audiences: readonly string[]) {
    super('AI provider not approved for this content')
    this.name = 'PrivacyPendingError'
  }
}

/** True for a non-empty list made only of known audiences. */
function validAudiences(audiences: unknown): audiences is AiAudience[] {
  return Array.isArray(audiences)
    && audiences.length > 0
    && audiences.every(a => (AUDIENCES as readonly unknown[]).includes(a))
}

/** True when `provider` is approved for every audience listed. Any doubt is false. */
export function providerApproved(provider: string, audiences: unknown): boolean {
  if (!validAudiences(audiences)) return false
  const row = Object.prototype.hasOwnProperty.call(PRIVACY_APPROVALS, provider) ? PRIVACY_APPROVALS[provider] : undefined
  return !!row && audiences.every(a => row[a] === true)
}

/** Throws PrivacyPendingError unless `provider` is approved for every audience listed. */
export function assertProviderApproved(provider: string, audiences: unknown): asserts audiences is AiAudience[] {
  if (!providerApproved(provider, audiences)) {
    throw new PrivacyPendingError(Array.isArray(audiences) ? audiences.map(String) : [])
  }
}

/** True when at least one provider is approved for every audience listed. */
export function audienceApproved(audiences: unknown): boolean {
  return Object.keys(PRIVACY_APPROVALS).some(p => providerApproved(p, audiences))
}
