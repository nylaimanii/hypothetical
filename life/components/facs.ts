// expressions as blends of facial action units (facs). ekman & friesen 1978, facial action coding system; prototypes
// follow the emfacs emotion predictions in ekman, friesen & hager 2002 (facs manual, investigator's guide,
// https://www.paulekman.com/facial-action-coding-system/). the face is chunky and stylized: each au drives a
// simple part (a brow tilt, a lid, a mouth corner), never a realistic mesh.
//
// au  name                     drives
// 1   inner brow raiser        inner ends of the brows up
// 2   outer brow raiser        outer ends of the brows up
// 4   brow lowerer             brows down and together (furrow)
// 5   upper lid raiser         eyes open wider
// 6   cheek raiser             lower lids up, cheeks lift (the duchenne part of a real smile)
// 7   lid tightener            narrowed eyes
// 12  lip corner puller        smile
// 14  dimpler                  one corner tucked (contempt, envy); asymmetric here
// 15  lip corner depressor     frown
// 17  chin raiser              pushes the lower lip up (sadness, doubt)
// 20  lip stretcher            mouth pulled wide (fear)
// 23  lip tightener            thin hard lips (anger)
// 24  lip pressor              lips pressed together
// 25  lips part
// 26  jaw drop
// 43  eyes closed              lids drop (tired, bored, numb)
import type { Emotion } from '@/lib/types'

export const AUS = ['au1', 'au2', 'au4', 'au5', 'au6', 'au7', 'au12', 'au14', 'au15', 'au17', 'au20', 'au23', 'au24', 'au25', 'au26', 'au43'] as const
export type AU = (typeof AUS)[number]
export type AUs = Record<AU, number>
export const zeroAUs = (): AUs => Object.fromEntries(AUS.map(a => [a, 0])) as AUs

type Proto = Partial<AUs> & { gaze?: number } // gaze: -1 down .. +1 up

// the ten sim emotions as au prototypes
export const PROTO: Record<Emotion, Proto> = {
  joy: { au6: 0.8, au12: 1, au25: 0.25 }, // 6+12 (ekman: felt smile)
  grief: { au1: 0.9, au4: 0.5, au15: 0.8, au17: 0.4, gaze: -0.8 }, // sadness: 1+4+15(+17)
  fear: { au1: 0.7, au2: 0.6, au4: 0.4, au5: 0.9, au20: 0.7, au25: 0.5, au26: 0.2 }, // 1+2+4+5+20+26
  anger: { au4: 1, au5: 0.4, au7: 0.7, au23: 0.8, au24: 0.5 }, // 4+5+7+23(+24)
  awe: { au1: 0.6, au2: 0.8, au5: 0.6, au25: 0.5, au26: 0.4, gaze: 0.6 }, // surprise: 1+2+5+26, gaze up
  hope: { au1: 0.35, au2: 0.3, au6: 0.2, au12: 0.35, gaze: 0.5 }, // ESTIMATE: soft lift + slight smile, looking up
  pride: { au6: 0.2, au12: 0.45, au24: 0.2, gaze: 0.2 }, // small smile, chin up (tracy & robins 2004, https://doi.org/10.1111/j.0956-7976.2004.01503008.x)
  envy: { au4: 0.4, au7: 0.3, au14: 0.6, au15: 0.2 }, // ESTIMATE: asymmetric dimpler like contempt (ekman: unilateral 14)
  boredom: { au43: 0.45, au15: 0.15, au24: 0.15, gaze: -0.2 }, // ESTIMATE: heavy lids, flat mouth
  distrust: { au4: 0.5, au7: 0.6, au14: 0.3, au24: 0.3 }, // ESTIMATE: narrowed, pressed, a little contempt
}

// named mixes the life view uses when two feelings are both strong
export const MIXES = {
  bittersweet: { ...blendRaw([[PROTO.joy, 0.55], [PROTO.grief, 0.55]]) }, // smiling mouth, raised inner brows
  nervousExcitement: { ...blendRaw([[PROTO.joy, 0.6], [PROTO.fear, 0.45]]) }, // smile with wide eyes and stretched lips
  numbGrief: { au1: 0.3, au15: 0.25, au43: 0.4, gaze: -0.4 } as Proto, // grief gone flat: heavy lids, almost no movement
}

function blendRaw(parts: [Proto, number][]): Proto {
  const out: Proto = {}
  for (const [p, w] of parts) for (const [k, v] of Object.entries(p)) (out as Record<string, number>)[k] = Math.max((out as Record<string, number>)[k] ?? 0, (v as number) * w)
  return out
}

// mood (0..1 per emotion) -> target action units. each emotion contributes by intensity above a resting floor, and
// au values combine by soft max (two feelings never add into a grimace). returns gaze too
export function moodToAUs(mood: Partial<Record<Emotion, number>>, fatigue = 0): { aus: AUs; gaze: number; mix: string | null } {
  const aus = zeroAUs()
  let gaze = 0, gw = 0
  const ex = (e: Emotion) => Math.max(0, (mood[e] ?? 0) - 0.15) / 0.85
  const joy = ex('joy'), grief = ex('grief'), fear = ex('fear')
  let mix: string | null = null
  const parts: [Proto, number][] = (Object.keys(PROTO) as Emotion[]).map(e => [PROTO[e], ex(e)])
  if (joy > 0.35 && grief > 0.35) { parts.push([MIXES.bittersweet, Math.min(joy, grief) * 1.2]); mix = 'bittersweet' }
  if (joy > 0.35 && fear > 0.35) { parts.push([MIXES.nervousExcitement, Math.min(joy, fear) * 1.2]); mix = 'nervous excitement' }
  if (grief > 0.5 && fatigue > 0.5) { parts.push([MIXES.numbGrief, fatigue]); mix = 'numb grief' }
  for (const [p, w] of parts) {
    if (w <= 0) continue
    for (const a of AUS) {
      const v = (p[a] ?? 0) * w
      aus[a] = 1 - (1 - aus[a]) * (1 - v) // soft max
    }
    if (p.gaze !== undefined) { gaze += p.gaze * w; gw += w }
  }
  // tiredness shows underneath every expression: heavier lids (a person in long grief looks tired even smiling)
  aus.au43 = Math.max(aus.au43, fatigue * 0.45)
  return { aus, gaze: gw ? gaze / gw : 0, mix }
}

// micro-expressions: a brief flinch at news. ekman's micro-expressions last ~1/25 to 1/5 s; staged slower here
// (~0.5 s) so a viewer can catch them
export const FLINCH: Record<Emotion, Proto> = {
  fear: { au1: 0.8, au2: 0.7, au4: 0.5, au5: 1, au20: 0.8 },
  grief: { au1: 1, au4: 0.6, au15: 0.9, au17: 0.6 },
  anger: { au4: 1, au7: 0.8, au23: 1 },
  joy: { au6: 1, au12: 1, au25: 0.6, au26: 0.3 },
  awe: { au1: 0.8, au2: 1, au5: 1, au26: 0.6 },
  hope: { au1: 0.5, au2: 0.5, au12: 0.5 },
  pride: { au12: 0.7, au6: 0.4 },
  envy: { au14: 0.8, au4: 0.4 },
  boredom: { au43: 0.6 },
  distrust: { au4: 0.7, au7: 0.8, au14: 0.4 },
}

// feeling in words, for the optional caption ("relieved, a little scared")
const WORD: Record<Emotion, [string, string, string]> = {
  joy: ['content', 'happy', 'overjoyed'], grief: ['a little sad', 'sad', 'heartbroken'], fear: ['a little scared', 'scared', 'terrified'],
  anger: ['irritated', 'angry', 'furious'], awe: ['curious', 'amazed', 'awestruck'], hope: ['hopeful', 'hopeful', 'full of hope'],
  pride: ['quietly proud', 'proud', 'very proud'], envy: ['a little envious', 'envious', 'bitter'], boredom: ['restless', 'bored', 'numb'],
  distrust: ['wary', 'suspicious', 'distrustful'],
}
export function feelingWords(mood: Partial<Record<Emotion, number>>, mix: string | null): string {
  if (mix) return mix
  const top = (Object.entries(mood) as [Emotion, number][]).filter(([, v]) => v > 0.25).sort((a, b) => b[1] - a[1]).slice(0, 2)
  if (!top.length) return 'calm'
  return top.map(([e, v], i) => { const w = WORD[e][v > 0.7 ? 2 : v > 0.45 ? 1 : 0]; return i && v < 0.45 && !w.startsWith('a little') ? `a little ${w}` : w }).join(', ')
}
