import { Suspense } from 'react'
import type { Metadata } from 'next'
import Assumptions from '@/components/ui/Assumptions'

export const metadata: Metadata = {
  title: 'assumptions · hypothetical',
  description: 'every rule the simulation runs on, its value and where it comes from. locally, rerun a world with any of them changed.',
}

// reads ?run= on the client, so the shell prerenders
export default function AssumptionsPage() {
  return <Suspense fallback={<main className="page-scroll bg-bone" />}><Assumptions /></Suspense>
}
