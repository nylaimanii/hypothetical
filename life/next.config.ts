// the one life site. a separate next app (vercel root directory "life") that imports the main site's pip and city
// modules read-only from ../src, and reads lives from ../data/lives at build time.
// dependencies come from the repo root node_modules (vercel.json installs there), so react and three exist once.
import path from 'node:path'
import type { NextConfig } from 'next'

const root = path.resolve(process.cwd(), '..') // next runs with cwd = life/

const nextConfig: NextConfig = {
  devIndicators: false,
  agentRules: false, // the repo root already has AGENTS.md
  turbopack: { root },
  outputFileTracingRoot: root,
  outputFileTracingIncludes: { '/**': ['../data/lives/**/*.json'] },
}

export default nextConfig
