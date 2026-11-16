// the tradeoff map's frontier: worlds that no other world beats on every axis. pure, so the consistency suite checks
// the same function the page draws with. every axis is "more is better": lifespan, population, freedom, off-world
export type Tradeoffs = { lifespan: number; population: number; freedom: number; freedomAverage?: number; offWorld: number; frontier?: string }
export type TradeoffWorld = { runId: string; agentId: string; seed: number; generation: number; simVersion?: string; status: string; score: number; tradeoffs: Tradeoffs | null }

export const AXES = ['lifespan', 'population', 'freedom', 'offWorld'] as const
type Axis = (typeof AXES)[number]

// a beats b when it is at least as good on every axis and better on one
export function dominates(a: Tradeoffs, b: Tradeoffs, axes: readonly Axis[] = AXES): boolean {
  let better = false
  for (const k of axes) {
    if (a[k] < b[k]) return false
    if (a[k] > b[k]) better = true
  }
  return better
}

// the run ids on the frontier, and for every other world one world that beats it on every axis
export function paretoFront<T extends { runId: string; tradeoffs: Tradeoffs }>(ws: T[], axes: readonly Axis[] = AXES): { front: Set<string>; beatenBy: Map<string, string> } {
  const front = new Set<string>(), beatenBy = new Map<string, string>()
  for (const w of ws) {
    const by = ws.find((o) => o !== w && dominates(o.tradeoffs, w.tradeoffs, axes))
    if (by) beatenBy.set(w.runId, by.runId)
    else front.add(w.runId)
  }
  return { front, beatenBy }
}
