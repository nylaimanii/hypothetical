import type { Metadata } from 'next'
import StoryView from '@/components/report/StoryView'

export const metadata: Metadata = { title: 'the story so far · hypothetical' }

// every world in order, what it taught, and whether later worlds listened
export default function StoryPage() {
  return <StoryView />
}
