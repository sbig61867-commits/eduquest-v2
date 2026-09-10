import type { Metadata } from 'next'
import { PolicyPage } from '@/components/public/policy'

export const metadata: Metadata = {
  title: 'سياسة الخصوصية — EduQuest',
  description: 'سياسة الخصوصية لمنصة EduQuest التعليمية. EduQuest Privacy Policy.',
}

export default function PrivacyPage() {
  return <PolicyPage kind="privacy" />
}
