import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import localFont from 'next/font/local'
import './globals.css'

// the main site's faces, from the repo's own font files (ofl), so the build needs no network
const fraunces = localFont({ src: [{ path: '../../fonts/Fraunces9pt-Regular.ttf', weight: '400' }, { path: '../../fonts/Fraunces9pt-SemiBold.ttf', weight: '600' }], variable: '--font-fraunces' })
const mono = localFont({ src: [{ path: '../../fonts/JetBrainsMono-Regular.ttf', weight: '400' }], variable: '--font-mono' })

export const metadata: Metadata = {
  title: 'one life',
  description: 'one person per world, birth to death. each life leaves a lesson for the next.',
}
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#efe8da' }

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  )
}
