'use client'
// everything is synthesized with the web audio api, no audio files

type Bus = { ctx: AudioContext; master: GainNode; noise: AudioBuffer }

let bus: Bus | null = null
let hum: { tense: GainNode; filter: BiquadFilterNode; lfo: OscillatorNode; lfoGain: GainNode } | null = null
let crowd: { gain: GainNode; bands: BiquadFilterNode[]; mod: OscillatorNode; modGain: GainNode } | null = null

function makeNoise(ctx: AudioContext) {
  const len = ctx.sampleRate * 2
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  let b = 0
  for (let i = 0; i < len; i++) {
    // soft brownish noise
    b = (b + 0.02 * (Math.random() * 2 - 1)) / 1.02
    d[i] = b * 3.5
  }
  return buf
}

function noiseSource(loop = true) {
  const src = bus!.ctx.createBufferSource()
  src.buffer = bus!.noise
  src.loop = loop
  return src
}

export function soundStart(volume: number, fadeSeconds = 0.3) {
  if (!bus) {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    const master = ctx.createGain()
    master.gain.value = 0
    master.connect(ctx.destination)
    bus = { ctx, master, noise: makeNoise(ctx) }
    buildHum()
    buildCrowd()
  }
  void bus.ctx.resume()
  bus.master.gain.cancelScheduledValues(bus.ctx.currentTime)
  bus.master.gain.setTargetAtTime(Math.max(0, Math.min(1, volume)) * 0.5, bus.ctx.currentTime, fadeSeconds / 3)
}

export function soundStop() {
  if (!bus) return
  const t = bus.ctx.currentTime
  bus.master.gain.cancelScheduledValues(t)
  bus.master.gain.setTargetAtTime(0, t, 0.15)
  setTimeout(() => { void bus?.ctx.suspend() }, 600)
}

// dev inspection: context state and master gain
export const soundState = () => (bus ? { state: bus.ctx.state, gain: bus.master.gain.value } : null)

export function setVolume(v: number) {
  if (!bus) return
  bus.master.gain.setTargetAtTime(Math.max(0, Math.min(1, v)) * 0.5, bus.ctx.currentTime, 0.1)
}

// ambient: two calm drones, a beating dissonant layer fades in with global unrest
function buildHum() {
  const { ctx, master } = bus!
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 380
  const out = ctx.createGain()
  out.gain.value = 0.22
  filter.connect(out).connect(master)
  for (const [f, g] of [[55, 0.5], [82.4, 0.32], [110.2, 0.12]] as const) {
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.value = f
    const gg = ctx.createGain()
    gg.gain.value = g
    o.connect(gg).connect(filter)
    o.start()
  }
  const tense = ctx.createGain()
  tense.gain.value = 0
  for (const f of [58.3, 77.8]) {
    const o = ctx.createOscillator()
    o.type = 'triangle'
    o.frequency.value = f
    o.connect(tense)
    o.start()
  }
  // tremolo that quickens with tension
  const lfo = ctx.createOscillator()
  lfo.frequency.value = 0.15
  const lfoGain = ctx.createGain()
  lfoGain.gain.value = 0.05
  lfo.connect(lfoGain).connect(out.gain)
  lfo.start()
  tense.connect(filter)
  hum = { tense, filter, lfo, lfoGain }
}

export function setTension(x: number) {
  if (!bus || !hum) return
  const t = bus.ctx.currentTime
  const k = Math.max(0, Math.min(1, x))
  hum.tense.gain.setTargetAtTime(k * 0.45, t, 1.5)
  hum.filter.frequency.setTargetAtTime(320 + k * 700, t, 1.5)
  hum.lfo.frequency.setTargetAtTime(0.15 + k * 3.5, t, 1.5)
  hum.lfoGain.gain.setTargetAtTime(0.04 + k * 0.1, t, 1.5)
}

// crowd: noise through vowel-ish bands with a slow swell; anger brightens and speeds it up
function buildCrowd() {
  const { ctx, master } = bus!
  const src = noiseSource()
  const gain = ctx.createGain()
  gain.gain.value = 0
  const mod = ctx.createOscillator()
  mod.frequency.value = 0.4
  const modGain = ctx.createGain()
  modGain.gain.value = 0
  mod.connect(modGain).connect(gain.gain)
  mod.start()
  const bands = [350, 900, 2200].map((f, i) => {
    const b = ctx.createBiquadFilter()
    b.type = 'bandpass'
    b.frequency.value = f
    b.Q.value = 3 + i
    src.connect(b).connect(gain)
    return b
  })
  gain.connect(master)
  src.start()
  crowd = { gain, bands, mod, modGain }
}

export function setCrowd(level: number, anger: number) {
  if (!bus || !crowd) return
  const t = bus.ctx.currentTime
  const a = Math.max(0, Math.min(1, anger))
  const base = Math.max(0, Math.min(1, level)) * (0.05 + a * 0.12)
  crowd.gain.gain.setTargetAtTime(base, t, 0.6)
  crowd.modGain.gain.setTargetAtTime(base * (0.4 + a * 0.5), t, 0.6)
  crowd.mod.frequency.setTargetAtTime(0.4 + a * 3, t, 0.6)
  crowd.bands.forEach((b, i) => b.frequency.setTargetAtTime([350, 900, 2200][i] * (1 + a * 0.45), t, 0.6))
}

// one shots
export function chime() {
  if (!bus) return
  const { ctx, master } = bus
  const t = ctx.currentTime
  for (const [f, g, d] of [[196, 0.22, 3.2], [293.7, 0.12, 2.6], [392, 0.06, 2]] as const) {
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.value = f
    const e = ctx.createGain()
    e.gain.setValueAtTime(0, t)
    e.gain.linearRampToValueAtTime(g, t + 0.02)
    e.gain.exponentialRampToValueAtTime(0.0001, t + d)
    o.connect(e).connect(master)
    o.start(t)
    o.stop(t + d + 0.1)
  }
}

export function rumble(severity = 0.6) {
  if (!bus) return
  const { ctx, master } = bus
  const t = ctx.currentTime
  const src = noiseSource(false)
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 140
  const e = ctx.createGain()
  const peak = 0.5 + severity * 0.6
  e.gain.setValueAtTime(0, t)
  e.gain.linearRampToValueAtTime(peak, t + 0.15)
  e.gain.exponentialRampToValueAtTime(0.0001, t + 2.4)
  src.connect(lp).connect(e).connect(master)
  src.start(t)
  src.stop(t + 2.5)
  const o = ctx.createOscillator()
  o.frequency.setValueAtTime(48, t)
  o.frequency.exponentialRampToValueAtTime(28, t + 2)
  const og = ctx.createGain()
  og.gain.setValueAtTime(peak * 0.5, t)
  og.gain.exponentialRampToValueAtTime(0.0001, t + 2.2)
  o.connect(og).connect(master)
  o.start(t)
  o.stop(t + 2.3)
}

export function whoosh() {
  if (!bus) return
  const { ctx, master } = bus
  const t = ctx.currentTime
  const src = noiseSource(false)
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.Q.value = 1.2
  bp.frequency.setValueAtTime(160, t)
  bp.frequency.exponentialRampToValueAtTime(3200, t + 3.2)
  const e = ctx.createGain()
  e.gain.setValueAtTime(0, t)
  e.gain.linearRampToValueAtTime(0.5, t + 2.4)
  e.gain.exponentialRampToValueAtTime(0.0001, t + 4)
  src.connect(bp).connect(e).connect(master)
  src.start(t)
  src.stop(t + 4.1)
}
