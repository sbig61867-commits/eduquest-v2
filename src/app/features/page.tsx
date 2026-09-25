import type { Metadata } from 'next'
import { MarketingPage, marketingMetadata } from '@/components/public/marketing-page'
import { FeaturesPage } from '@/components/public/features-page'

export function generateMetadata(): Promise<Metadata> {
  return marketingMetadata('features', '/features')
}

export default function Features() {
  return <MarketingPage><FeaturesPage /></MarketingPage>
}
