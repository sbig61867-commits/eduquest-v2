import type { Metadata } from 'next'
import { MarketingPage, marketingMetadata } from '@/components/public/marketing-page'
import { PolicyPage } from '@/components/public/policy'

export function generateMetadata(): Promise<Metadata> {
  return marketingMetadata('terms', '/terms')
}

export default function TermsPage() {
  return <MarketingPage sections={['policy']}><PolicyPage kind="terms" /></MarketingPage>
}
