import type { Metadata } from 'next'
import { marketingMetadata } from '@/components/public/marketing-page'
import { DemoLanding } from '@/components/public/demo-landing'

// Also served as /ar/demo and /en/demo (a marketing path, src/i18n/public-routes.ts).
// Messages and the `.eq-public` appearance scope come from ./layout.tsx.
export function generateMetadata(): Promise<Metadata> {
  return marketingMetadata('demo', '/demo')
}

export default function DemoPage() {
  return <DemoLanding />
}
