import type { Metadata } from 'next'
import Tradeoffs from '@/components/ui/Tradeoffs'

export const metadata: Metadata = {
  title: 'tradeoffs · hypothetical',
  description: 'every world at its end: lifespan, population, freedom and off-world progress, with the worlds nothing beats on all four.',
}

export default function TradeoffsPage() {
  return <Tradeoffs />
}
