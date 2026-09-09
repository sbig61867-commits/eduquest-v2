import type { Metadata } from 'next'
import { Landing } from '@/components/public/landing'

export const metadata: Metadata = {
  title: 'EduQuest · منصة تعليمية سحابية للجامعات',
  description:
    'EduQuest منصة تعليمية متكاملة للجامعات: دروس واختبارات بالذكاء الاصطناعي، مراقبة ذكية للاختبارات، علامات فورية، وعزل كامل لكل جامعة. AI lessons & exams, smart proctoring, instant grades.',
}

export default function RootPage() {
  return <Landing />
}
