// npm run promote-stable: if origin/main typechecks, builds and passes tests in a clean copy, fast-forward
// origin "stable" to it (vercel deploys from stable). evolve runs this daily between 3 and 6am
import '../src/lib/evolve/env'
import { promoteStable } from '../src/lib/evolve/maintenance'

const r = promoteStable()
console.log(`stable: ${r.note}`)
process.exit(0)
