'use client'
import { useSyncExternalStore } from 'react'

const QUERY = '(max-width: 1399.98px)'

// under 1400px the side panels become edge tabs so the globe keeps the center
export function useNarrow() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(QUERY)
      m.addEventListener('change', cb)
      return () => m.removeEventListener('change', cb)
    },
    () => window.matchMedia(QUERY).matches,
    () => false,
  )
}

const ICON = {
  left: (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><rect x="2" y="3" width="12" height="2" rx="1" fill="currentColor" /><rect x="2" y="7" width="9" height="2" rx="1" fill="currentColor" /><rect x="2" y="11" width="6" height="2" rx="1" fill="currentColor" /></svg>
  ),
  right: (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><rect x="2" y="2" width="12" height="12" rx="3" fill="none" stroke="currentColor" strokeWidth="1.6" /><rect x="9" y="2" width="1.6" height="12" fill="currentColor" /></svg>
  ),
}

export function SideDrawer({ side, open, onToggle, label, reserveBottom = false, children }: { side: 'left' | 'right'; open: boolean; onToggle: () => void; label: string; reserveBottom?: boolean; children: React.ReactNode }) {
  const left = side === 'left'
  return (
    <>
      <button
        onClick={onToggle}
        aria-label={open ? `hide ${label}` : `show ${label}`}
        title={label}
        className={`panel pointer-events-auto absolute top-0 z-20 flex h-10 w-10 items-center justify-center transition ${left ? 'left-0' : 'right-0'} ${open ? 'bg-ink! text-bone' : 'text-ink/70 hover:text-ink'}`}
      >
        {ICON[side]}
      </button>
      <div
        className={`absolute top-12 z-10 flex ${reserveBottom ? 'bottom-14' : 'bottom-0'} min-h-0 flex-col gap-3 transition-transform duration-300 ease-out ${left ? 'left-0' : 'right-0'} ${open ? 'translate-x-0' : left ? '-translate-x-[calc(100%+2rem)]' : 'translate-x-[calc(100%+2rem)]'}`}
        aria-hidden={!open}
      >
        <div className="scroll-thin flex min-h-0 flex-col gap-3 overflow-y-auto">{children}</div>
      </div>
    </>
  )
}
