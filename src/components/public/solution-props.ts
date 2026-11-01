import { getLocale, getTranslations } from 'next-intl/server'
import { toLocale } from '@/i18n/config'
import { getDemoData } from '@/lib/demo/data'
import { getTerms } from '@/lib/terminology'
import { getRoleLabel } from '@/lib/utils'
import type { SolutionType } from './solutions-page'
import type enPublic from '@/messages/en/public.json'

type Demo = ReturnType<typeof getDemoData>
type Samples = typeof enPublic.solutions.types.school.samples

/** Relabels the demo fixtures with one institution type's sample content.
 *  Every number, date and status stays the fixture's, only the names change. */
export function withSamples(d: Demo, x: Samples): Demo {
  const exams = d.exams.map((e, i) => ({ ...e, title: x.exams[i] ?? e.title }))
  const graded = exams.flatMap(e => (e.status === 'graded' ? [{ exam: e.title, score: e.score, outOf: e.outOf }] : []))
  const homework = d.grades[d.grades.length - 1]
  const schedule = x.schedule as Record<string, string[]>
  return {
    ...d,
    courses: d.courses.map((c, i) => ({ ...c, ...(x.courses[i] ?? {}) })),
    exams,
    upcomingExams: exams.filter(e => e.status === 'upcoming'),
    grades: [...graded, { ...homework, exam: x.homework }],
    announcements: d.announcements.map((a, i) => ({ ...a, ...(x.announcements[i] ?? {}) })),
    schedule: d.schedule.map(row => ({ ...row, slots: schedule[String(row.day)] ?? row.slots })),
    requests: d.requests.map((r, i) => ({ ...r, subject: x.requests[i] ?? r.subject })),
    teacherGroups: d.teacherGroups.map((g, i) => ({ ...g, name: x.groups[i] ?? g.name })),
  }
}

/** Server side props of a /solutions/<type> page: demo fixtures + that type's vocabulary.
 *  The university page shows the fixtures as they are; other types get their own sample names. */
export async function solutionProps(type: SolutionType) {
  const locale = toLocale(await getLocale())
  const demo = getDemoData(locale)
  const t = await getTranslations('public')
  return {
    type,
    demo: type === 'university' ? demo : withSamples(demo, t.raw(`solutions.types.${type}.samples`) as Samples),
    terms: getTerms(type, locale),
    roles: {
      admin: getRoleLabel('university_admin', type, locale),
      centre: getRoleLabel('center_manager', type, locale),
      teacher: getRoleLabel('teacher', type, locale),
      student: getRoleLabel('student', type, locale),
    },
  }
}
