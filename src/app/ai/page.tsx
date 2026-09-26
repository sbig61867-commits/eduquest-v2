import type { Metadata } from 'next'
import { MarketingPage, marketingMetadata } from '@/components/public/marketing-page'
import { AiPage } from '@/components/public/ai-page'

export function generateMetadata(): Promise<Metadata> {
  return marketingMetadata('ai', '/ai')
}

export default function ResponsibleAi() {
  return <MarketingPage><AiPage /></MarketingPage>
}
