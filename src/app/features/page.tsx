import type { Metadata } from 'next'
import { FeaturesPage } from '@/components/public/features-page'

export const metadata: Metadata = {
  title: 'المميزات · EduQuest',
  description: 'مميزات منصة EduQuest: توليد الدروس والاختبارات بالذكاء الاصطناعي، مراقبة ذكية، عزل كامل لكل جامعة، وعلامات فورية. EduQuest platform features.',
}

export default function Features() {
  return <FeaturesPage />
}
