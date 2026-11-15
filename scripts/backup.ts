// npm run backup: push the small files that hold what the ai learned to the origin "data-backup" branch now
// (evolve does this daily). restore with: git checkout origin/data-backup -- data/
import '../src/lib/evolve/env'
import { backupToGit } from '../src/lib/evolve/maintenance'

const r = backupToGit()
console.log(`${r.note}${r.sha ? ` (${r.sha.slice(0, 7)})` : ''}`)
