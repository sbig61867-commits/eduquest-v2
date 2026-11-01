import type { Metadata } from 'next'
import { MarketingPage, marketingMetadata } from '@/components/public/marketing-page'
import { LegalPage } from '@/components/public/legal-page'

export function generateMetadata(): Promise<Metadata> {
  return marketingMetadata('legal', '/legal')
}

export default function LegalCentrePage() {
  return <MarketingPage sections={['legal', 'policy']}><LegalPage /></MarketingPage>
}
