// import first in every script: loads .env.local before any module that reads process.env at load time
import { config } from 'dotenv'
config({ path: '.env.local', quiet: true })
