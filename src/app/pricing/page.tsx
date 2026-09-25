import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { PricingPage } from '@/components/public/pricing-page'
import { pricingEnabled } from '@/lib/pricing/plans'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('public.meta.pricing')
  return { title: t('title'), description: t('description') }
}

export default function Pricing() {
  if (!pricingEnabled) notFound()
  return <PricingPage />
}
