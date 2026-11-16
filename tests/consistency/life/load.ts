// every recorded life on disk (data/lives/<world>/<life>.json), for the life consistency checks
import fs from 'node:fs'
import path from 'node:path'
import type { LifeRecord } from '../../../src/lib/life/types'

export function allLives(): LifeRecord[] {
  const root = path.join(process.cwd(), 'data', 'lives')
  const out: LifeRecord[] = []
  for (const w of fs.readdirSync(root, { withFileTypes: true })) {
    if (!w.isDirectory()) continue
    for (const f of fs.readdirSync(path.join(root, w.name))) {
      if (!/-life-\d+\.json$/.test(f)) continue
      out.push(JSON.parse(fs.readFileSync(path.join(root, w.name, f), 'utf8')) as LifeRecord)
    }
  }
  // the pre-commit hook names the lives to check (newest few); otherwise every life on disk
  const only = process.env.HYP_CONSISTENCY_LIVES?.split(',').map(s => s.trim()).filter(Boolean)
  return only?.length ? out.filter(r => only.includes(r.lifeId)) : out
}

// the summary index (what the home page and the switcher read), every world
import type { LifeSummary } from '../../../src/lib/life/types'
export function allSummaries(): LifeSummary[] {
  const root = path.join(process.cwd(), 'data', 'lives')
  const out: LifeSummary[] = []
  for (const w of fs.readdirSync(root, { withFileTypes: true })) {
    const f = path.join(root, w.name, 'index.json')
    if (w.isDirectory() && fs.existsSync(f)) out.push(...(JSON.parse(fs.readFileSync(f, 'utf8')) as LifeSummary[]))
  }
  return out
}
