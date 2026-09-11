import type { Metadata } from 'next'
import { PolicyPage } from '@/components/public/policy'

export const metadata: Metadata = {
  title: 'سياسة الكوكيز · EduQuest',
  description: 'سياسة ملفات تعريف الارتباط لمنصة EduQuest. EduQuest Cookie Policy.',
}

export default function CookiesPage() {
  return <PolicyPage kind="cookies" />
}
