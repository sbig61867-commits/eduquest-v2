import type { Metadata } from 'next'
import { MarketingPage, marketingMetadata } from '@/components/public/marketing-page'
import { PolicyPage } from '@/components/public/policy'

export function generateMetadata(): Promise<Metadata> {
  return marketingMetadata('privacy', '/privacy')
}

export default function PrivacyPage() {
  return <MarketingPage sections={['policy']}><PolicyPage kind="privacy" /></MarketingPage>
}
