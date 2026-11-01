import type { Metadata } from 'next'
import { RoleTourPage, roleTourMetadata } from '@/components/demo/role-tour'

// /demo/<role>/<page>: the university role tours (src/components/demo/role-tour.tsx).
type Props = { params: Promise<{ role: string; page?: string[] }> }

export function generateMetadata(props: Props): Promise<Metadata> {
  return roleTourMetadata('university', true, props.params)
}

export default function DemoRoleTour({ params }: Props) {
  return <RoleTourPage type="university" fromDemo params={params} />
}
