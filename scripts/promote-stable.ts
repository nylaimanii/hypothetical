// npm run promote-stable: origin/main plus the real showcase data (src/lib/evolve/deploy.ts). if that typechecks,
// builds, passes the tests and the consistency suite in a clean copy, origin "stable" moves to it (vercel deploys
// from stable). evolve runs this daily between 3 and 6am. --dry: do every check, push nothing
import '../src/lib/evolve/env'
import { promoteStable } from '../src/lib/evolve/maintenance'

const r = promoteStable(console.log, { dry: process.argv.includes('--dry') })
console.log(`stable: ${r.note}`)
process.exit(0)
