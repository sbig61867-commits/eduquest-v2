import type { Metadata } from 'next'
import { AiAssistantPage } from '@/components/public/ai-assistant-page'

export const metadata: Metadata = {
  title: 'مساعد الذكاء الاصطناعي — EduQuest',
  description: 'ولّد دروساً واختباراً كاملاً بالذكاء الاصطناعي من موضوع واحد، قابل للتعديل قبل النشر. AI-generated lessons and exams on EduQuest.',
}

export default function AiAssistant() {
  return <AiAssistantPage />
}
