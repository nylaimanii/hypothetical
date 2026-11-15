import type { Emotion, Mood } from '@/lib/types'

export const EMOTIONS: Emotion[] = ['joy', 'fear', 'anger', 'hope', 'grief', 'pride', 'envy', 'boredom', 'awe', 'distrust']
const clamp = (v: number) => Math.max(0, Math.min(1, v))

// 0 miserable, 0.5 neutral, 1 thriving
export function valence(m: Mood) {
  const pos = (m.joy + m.hope + m.pride + m.awe) / 4
  const neg = (m.fear + m.anger + m.grief + m.envy + m.distrust) / 5
  return clamp(0.5 + (pos - neg))
}

export function dominant(m: Mood): Emotion {
  let best: Emotion = 'boredom'
  for (const e of EMOTIONS) if (m[e] > m[best]) best = e
  return best
}

// a plausible emotion mix around a single valence, used by the mock and as a fallback
export function moodFrom(v: number, tilt: Partial<Mood> = {}): Mood {
  const n = 1 - v
  return {
    joy: clamp(v * 0.75), hope: clamp(v * 0.65), pride: clamp(v * 0.35), awe: clamp(v * 0.2),
    fear: clamp(n * 0.45), anger: clamp(n * n * 0.9), grief: clamp(n * 0.3), envy: clamp(n * 0.25), distrust: clamp(n * 0.55), boredom: 0.2,
    ...tilt,
  }
}
