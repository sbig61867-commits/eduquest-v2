import type { Metadata } from 'next'
import { Landing } from '@/components/public/landing'

export const metadata: Metadata = {
  title: 'EduQuest — منصة تعليمية سحابية للمؤسسات التعليمية',
  description:
    'EduQuest منصة تعليمية متكاملة للجامعات والمدارس والمعاهد ومراكز التدريب: دروس واختبارات بالذكاء الاصطناعي، مراقبة ذكية للاختبارات، علامات فورية، وعزل كامل لكل مؤسسة. AI lessons & exams, smart proctoring, instant grades.',
}

export default function RootPage() {
  return <Landing />
}
