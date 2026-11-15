// the only entry points C uses from B. swap the stub for the real modules once B pushes:
// export { runWorld } from '../sim/run'
// export { askCore } from '../agent/ask'
export { runWorld, askCore } from './_stub'
