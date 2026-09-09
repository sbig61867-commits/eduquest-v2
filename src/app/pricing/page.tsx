import type { Metadata } from 'next'
import { PricingPageContent } from '@/components/public/pricing-page'

export const metadata: Metadata = {
  title: 'الأسعار — EduQuest',
  description: 'باقات EduQuest للجامعات — ابدأ مجاناً واختر الباقة المناسبة لحجم جامعتك. EduQuest pricing plans.',
}

export default function PricingPage() {
  return <PricingPageContent />
}
