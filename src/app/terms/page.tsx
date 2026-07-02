import type { Metadata } from 'next'
import { PolicyPage } from '@/components/public/policy'

export const metadata: Metadata = {
  title: 'شروط الاستخدام — EduQuest',
  description: 'شروط استخدام منصة EduQuest التعليمية. EduQuest Terms of Use.',
}

export default function TermsPage() {
  return <PolicyPage kind="terms" />
}
