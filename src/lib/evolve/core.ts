// the only entry points C uses from B. swap the stub for the real modules once B pushes,
// and flip CORE_REAL so telegram /ask stops answering "core offline":
// export { runWorld } from '../sim/run'
// export { askCore } from '../agent/ask'
// export const CORE_REAL = true
export { runWorld, askCore } from './_stub'
export const CORE_REAL = false
