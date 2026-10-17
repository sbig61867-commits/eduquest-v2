import type { Metadata } from 'next'
import { MarketingPage, marketingMetadata } from '@/components/public/marketing-page'
import { AboutPage } from '@/components/public/about-page'

export function generateMetadata(): Promise<Metadata> {
  return marketingMetadata('about', '/about')
}

export default function About() {
  return <MarketingPage sections={['aboutPage']}><AboutPage /></MarketingPage>
}
