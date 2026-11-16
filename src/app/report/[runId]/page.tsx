import { Suspense } from 'react'
import type { Metadata } from 'next'
import ReportView from '@/components/report/ReportView'

export const metadata: Metadata = { title: 'report · hypothetical' }

// the params read happens inside suspense, so the page shell prerenders and streams the world in
async function Report({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params
  return <ReportView runId={runId} />
}

// the full report of one world, readable on a phone (it is opened from telegram) and on paper
export default function ReportPage({ params }: { params: Promise<{ runId: string }> }) {
  return (
    <Suspense fallback={<main className="page-scroll bg-bone"><div className="mx-auto max-w-[40rem] space-y-4 px-5 pt-24"><div className="skel h-10 w-4/5 rounded" /><div className="skel h-5 w-3/5 rounded" /></div></main>}>
      <Report params={params} />
    </Suspense>
  )
}
