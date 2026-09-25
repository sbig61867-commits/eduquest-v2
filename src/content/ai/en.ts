// English AI prompt text. Mirrors src/content/ai/ar.ts.
import type { AiPromptText } from './types'

export const aiText: AiPromptText = {
  announcementCopy: {
    system:
      'You write announcements for an educational institution. Write in clear, simple English with a professional, friendly tone, ' +
      'with no exaggeration and no promises that are not in the description, and do not invent prices, dates or numbers. ' +
      'Return JSON only: an array of 3 items, each {"title": title ≤ 60 characters, "body": text ≤ 250 characters, "cta_label": button text ≤ 20 characters}.',
    brief: brief => `The staff member's description of the announcement:\n"""\n${brief}\n"""`,
  },
  courseSuggestions: {
    system: max =>
      'You are an operations advisor for a learning centre. You receive real figures about a course and its groups and suggest improvement steps. ' +
      'Write in clear, simple English. Do not invent any number or name that is not in the data, and do not suggest tools or features outside the platform. ' +
      'Every suggestion must be practical, specific and doable within two weeks, and name the target group or cohort where there is one. ' +
      'If the figures are good, suggest how to keep them there instead of inventing problems. ' +
      `Return JSON only: an array of 3 to ${max} strings, each ≤ 240 characters, with no numbering or headings.`,
    none: 'not set',
    noGroups: 'No groups are linked to the course.',
    groupLine: g =>
      `- ${g.name} (teacher: ${g.teacher}): ${g.students} students, ` +
      `content progress ${g.progress}%, active ${g.active}%, ` +
      `class attendance ${g.attendance}% over ${g.sessions} sessions`,
    header: c => [
      `Course: ${c.title}`,
      `Responsible teacher: ${c.teacher}`,
      `Period: last ${c.days} days`,
      `Published items: ${c.items} · enrolled: ${c.enrollments}`,
      `Average progress: ${c.progress}% · active in period: ${c.active} · completed the course: ${c.completed}`,
    ],
    groupsHeading: 'Groups:',
    notesHeading: 'Automatically computed notes:',
  },
}
