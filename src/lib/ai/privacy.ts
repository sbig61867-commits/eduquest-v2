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
// Only `public` is approved for the providers in the chain. Approval for
// institution or personal content needs a reviewed privacy and retention policy
// for that provider, and it is recorded here explicitly.
//
// The check runs inside meterCall() (meter.ts), which every provider call goes
// through, so a call that forgets its audience is refused before any network I/O.

export type AiAudience = 'public' | 'institution' | 'personal'

const AUDIENCES: readonly AiAudience[] = ['public', 'institution', 'personal']

export const PRIVACY_APPROVALS: Readonly<Record<string, Readonly<Record<AiAudience, boolean>>>> = {
  groq:       { public: true, institution: false, personal: false },
  // xkiro: no published API data terms found (2026-10-15) — no audience approved.
  xkiro:      { public: false, institution: false, personal: false },
  // cohere: prompts and generations train Cohere models unless opted out; opt-out is
  // for enterprise customers (enterprise data commitments, read 2026-10-15) — none approved.
  cohere:     { public: false, institution: false, personal: false },
  // gemini: unpaid quota content may be used by Google to improve products and read
  // by human reviewers (Gemini API terms, 2026-03-23) — no audience approved.
  gemini:     { public: false, institution: false, personal: false },
  // openrouter: defers to each upstream model's terms; free routes are not pinned to one
  // upstream, so the terms cannot be confirmed — none approved.
  openrouter: { public: false, institution: false, personal: false },
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
