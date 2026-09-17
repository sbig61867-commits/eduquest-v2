import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PricingPage } from '@/components/public/pricing-page'
import { pricingEnabled } from '@/lib/pricing/plans'

export const metadata: Metadata = {
  title: 'الأسعار — EduQuest',
  description: 'باقات EduQuest للجامعات والمدارس والمعاهد ومراكز التدريب — تجربة مجانية ثم اشتراك حسب حجم مؤسستك. EduQuest pricing.',
}

export default function Pricing() {
  if (!pricingEnabled) notFound()
  return <PricingPage />
}
