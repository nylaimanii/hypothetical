// the entry points C uses from B (contract in CLAUDE.md, plus extractLessons for the learning loop,
// findDivergences for compare mode, and the llm client for constitution mutations and readiness checks)
export { runWorld } from '../sim/run'
export { askCore } from '../agent/ask'
export { extractLessons } from '../agent/lessons'
export { findDivergences } from '../sim/compare'
export { acquireOllamaLock, assertLlmReady, chat, llmEnabled, provider } from '../agent/llm'
export const CORE_REAL = true
