import type { Metadata } from 'next'
import { MarketingPage, marketingMetadata } from '@/components/public/marketing-page'
import { notFound } from 'next/navigation'
import { PricingPage } from '@/components/public/pricing-page'
import { pricingEnabled } from '@/lib/pricing/plans'

export function generateMetadata(): Promise<Metadata> {
  return marketingMetadata('pricing', '/pricing')
}

export default function Pricing() {
  if (!pricingEnabled) notFound()
  return <MarketingPage><PricingPage /></MarketingPage>
}
