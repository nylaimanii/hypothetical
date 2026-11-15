// the entry points C uses from B (contract in CLAUDE.md, plus extractLessons for the learning loop)
export { runWorld } from '../sim/run'
export { askCore } from '../agent/ask'
export { extractLessons } from '../agent/lessons'
export const CORE_REAL = true
