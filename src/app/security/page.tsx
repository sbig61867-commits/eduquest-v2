import type { Metadata } from 'next'
import { MarketingPage, marketingMetadata } from '@/components/public/marketing-page'
import { SecurityPage } from '@/components/public/security-page'

export function generateMetadata(): Promise<Metadata> {
  return marketingMetadata('security', '/security')
}

export default function Security() {
  return <MarketingPage sections={['securityPage']}><SecurityPage /></MarketingPage>
}
