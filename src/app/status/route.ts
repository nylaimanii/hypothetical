// /status: C's local "what's running" page (GET /api/status?view=html). local only: unless both the host and any
// forwarded host are this machine, it's a 404, so the page never shows on a shared or deployed host
import type { NextRequest } from 'next/server'

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/

export async function GET(req: NextRequest) {
  const hosts = [req.headers.get('host') ?? '', ...(req.headers.get('x-forwarded-host') ?? '').split(',').map((h) => h.trim()).filter(Boolean)]
  if (!hosts.every((h) => LOCAL.test(h))) return new Response('not found', { status: 404 })
  return Response.redirect(new URL('/api/status?view=html', req.url), 307)
}
