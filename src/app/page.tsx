import type { Metadata } from 'next'
import { MarketingPage, marketingMetadata } from '@/components/public/marketing-page'
import { Landing } from '@/components/public/landing'

export function generateMetadata(): Promise<Metadata> {
  return marketingMetadata('home', '/')
}

export default function RootPage() {
  return <MarketingPage sections={['landing']}><Landing /></MarketingPage>
}
