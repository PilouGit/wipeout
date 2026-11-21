/**
 * Bruitages procéduraux. Chaque fonction joue un son one-shot dans `out` à l'instant `t`
 * et renvoie sa durée (s). Tout est synthétisé : oscillateurs, bruit filtré, résonateurs.
 */
export interface SfxContext {
  readonly ctx: AudioContext;
  readonly noise: AudioBuffer;
}

type Play = (k: SfxContext, out: AudioNode, t: number, intensity: number) => number;

function env(k: SfxContext, out: AudioNode, t: number, peak: number, attack: number, decay: number): GainNode {
  const g = k.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(out);
  return g;
}

function noiseSource(k: SfxContext, t: number, dur: number): AudioBufferSourceNode {
  const src = k.ctx.createBufferSource();
  src.buffer = k.noise;
  src.loop = true;
  src.start(t, Math.random() * (k.noise.duration - 0.1));
  src.stop(t + dur + 0.05);
  return src;
}

function osc(k: SfxContext, type: OscillatorType, t: number, dur: number): OscillatorNode {
  const o = k.ctx.createOscillator();
  o.type = type;
  o.start(t);
  o.stop(t + dur + 0.05);
  return o;
}

function filter(k: SfxContext, type: BiquadFilterType, freq: number, q = 1): BiquadFilterNode {
  const f = k.ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

/** Plaque d'accélération : souffle synthétique ascendant, renvoyé par un écho court. */
const speedPad: Play = (k, out, t) => {
  const dur = 0.45;
  const delay = k.ctx.createDelay(0.5);
  delay.delayTime.value = 0.09;
  const fb = k.ctx.createGain();
  fb.gain.value = 0.38;
  const tone = filter(k, 'lowpass', 3500);
  delay.connect(tone).connect(fb).connect(delay);
  const mix = k.ctx.createGain();
  mix.connect(out);
  mix.connect(delay);
  tone.connect(out);

  const bp = filter(k, 'bandpass', 300, 3);
  bp.frequency.setValueAtTime(300, t);
  bp.frequency.exponentialRampToValueAtTime(6000, t + dur);
  noiseSource(k, t, dur).connect(bp).connect(env(k, mix, t, 0.5, 0.05, dur));
  const saw = osc(k, 'sawtooth', t, dur);
  saw.frequency.setValueAtTime(160, t);
  saw.frequency.exponentialRampToValueAtTime(1100, t + dur);
  saw.connect(filter(k, 'lowpass', 2500, 4)).connect(env(k, mix, t, 0.12, 0.03, dur));
  return dur + 0.9;
};

/** Tir de plasma : impulsion percussive puis traînée sifflante modulée. */
const plasma: Play = (k, out, t) => {
  const click = osc(k, 'sine', t, 0.09);
  click.frequency.setValueAtTime(1500, t);
  click.frequency.exponentialRampToValueAtTime(90, t + 0.08);
  click.connect(env(k, out, t, 0.55, 0.002, 0.08));
  noiseSource(k, t, 0.03).connect(filter(k, 'highpass', 2500)).connect(env(k, out, t, 0.4, 0.001, 0.025));

  const dur = 0.75;
  const tail = osc(k, 'sawtooth', t, dur);
  tail.frequency.setValueAtTime(2600, t);
  tail.frequency.exponentialRampToValueAtTime(650, t + dur);
  const lfo = osc(k, 'sine', t, dur);
  lfo.frequency.value = 31;
  const depth = k.ctx.createGain();
  depth.gain.value = 140;
  lfo.connect(depth).connect(tail.frequency);
  const bp = filter(k, 'bandpass', 2600, 7);
  bp.frequency.setValueAtTime(2600, t);
  bp.frequency.exponentialRampToValueAtTime(700, t + dur);
  tail.connect(bp).connect(env(k, out, t + 0.01, 0.35, 0.02, dur));
  return dur + 0.1;
};

/** Missile : allumage sourd, grondement et sifflement montant. */
const missile: Play = (k, out, t) => {
  const thump = osc(k, 'sine', t, 0.25);
  thump.frequency.setValueAtTime(110, t);
  thump.frequency.exponentialRampToValueAtTime(40, t + 0.2);
  thump.connect(env(k, out, t, 0.6, 0.004, 0.2));
  const dur = 1.1;
  const lp = filter(k, 'lowpass', 500, 2);
  lp.frequency.linearRampToValueAtTime(1600, t + dur);
  noiseSource(k, t, dur).connect(lp).connect(env(k, out, t, 0.45, 0.05, dur));
  const whistle = osc(k, 'triangle', t, dur);
  whistle.frequency.setValueAtTime(520, t);
  whistle.frequency.exponentialRampToValueAtTime(1900, t + dur);
  whistle.connect(env(k, out, t + 0.05, 0.16, 0.1, dur - 0.1));
  return dur + 0.1;
};

/** Résonances inharmoniques d'une coque métallique (Hz). */
const HULL_MODES = [523, 1187, 1951, 2843, 4110];

/** Collision : bruit très bref qui excite des résonateurs métalliques à décroissance courte, plus un choc sourd. */
const collision: Play = (k, out, t, intensity) => {
  const v = Math.min(1, Math.max(0.15, intensity));
  const burst = k.ctx.createGain();
  noiseSource(k, t, 0.02).connect(env(k, burst, t, 1, 0.001, 0.015));
  HULL_MODES.forEach((f, i) => {
    const bp = filter(k, 'bandpass', f * (0.94 + Math.random() * 0.12), 28);
    const g = env(k, out, t, (0.9 / (i + 1)) * v, 0.002, 0.18 + 0.3 / (i + 1));
    burst.connect(bp).connect(g);
  });
  const body = osc(k, 'sine', t, 0.2);
  body.frequency.setValueAtTime(95, t);
  body.frequency.exponentialRampToValueAtTime(38, t + 0.18);
  body.connect(env(k, out, t, 0.7 * v, 0.003, 0.18));
  noiseSource(k, t, 0.12).connect(filter(k, 'lowpass', 900)).connect(env(k, out, t, 0.5 * v, 0.002, 0.1));
  return 0.6;
};

/** Frottement de coque : grain de bruit aigu filtré par des résonances peu amorties. */
const scrape: Play = (k, out, t, intensity) => {
  const dur = 0.09;
  const g = env(k, out, t, 0.18 * Math.max(0.3, intensity), 0.004, dur);
  const src = noiseSource(k, t, dur);
  const hp = filter(k, 'highpass', 1800);
  src.connect(hp);
  for (const f of [2300, 3700, 5200]) hp.connect(filter(k, 'bandpass', f * (0.9 + Math.random() * 0.2), 10)).connect(g);
  return dur + 0.05;
};

/** Alerte bouclier faible : double bip électronique aigu. */
const shieldAlert: Play = (k, out, t) => {
  for (const dt of [0, 0.13]) {
    const o = osc(k, 'square', t + dt, 0.07);
    o.frequency.value = 1760;
    o.connect(filter(k, 'lowpass', 5000)).connect(env(k, out, t + dt, 0.16, 0.003, 0.065));
  }
  return 0.3;
};

const blips = (notes: readonly (readonly [number, number, number])[], type: OscillatorType = 'square'): Play => (k, out, t) => {
  let end = 0;
  for (const [f, at, dur] of notes) {
    const o = osc(k, type, t + at, dur);
    o.frequency.value = f;
    o.connect(env(k, out, t + at, 0.14, 0.004, dur));
    end = Math.max(end, at + dur);
  }
  return end + 0.05;
};

const explosion: Play = (k, out, t) => {
  const lp = filter(k, 'lowpass', 1800, 1);
  lp.frequency.exponentialRampToValueAtTime(120, t + 1.4);
  noiseSource(k, t, 1.6).connect(lp).connect(env(k, out, t, 0.9, 0.005, 1.5));
  const sub = osc(k, 'sine', t, 0.8);
  sub.frequency.setValueAtTime(70, t);
  sub.frequency.exponentialRampToValueAtTime(25, t + 0.7);
  sub.connect(env(k, out, t, 0.9, 0.005, 0.7));
  collision(k, out, t, 1);
  return 1.7;
};

const shieldUp: Play = (k, out, t) => {
  const o = osc(k, 'sine', t, 0.45);
  o.frequency.setValueAtTime(300, t);
  o.frequency.exponentialRampToValueAtTime(900, t + 0.4);
  o.connect(env(k, out, t, 0.2, 0.02, 0.4));
  return 0.5;
};

const mines: Play = (k, out, t) => {
  const o = osc(k, 'square', t, 0.3);
  o.frequency.setValueAtTime(200, t);
  o.frequency.exponentialRampToValueAtTime(90, t + 0.25);
  o.connect(filter(k, 'lowpass', 1200)).connect(env(k, out, t, 0.2, 0.004, 0.25));
  return 0.35;
};

export const SFX = {
  speedPad,
  plasma,
  missile,
  collision,
  scrape,
  shieldAlert,
  explosion,
  shieldUp,
  mines,
  countdown: blips([[440, 0, 0.25]]),
  go: blips([[880, 0, 0.5]]),
  pickup: blips([[660, 0, 0.08], [990, 0.07, 0.1]]),
  lap: blips([[740, 0, 0.15], [990, 0.12, 0.25]]),
  fanfare: blips([[523, 0, 0.2], [659, 0.15, 0.2], [784, 0.3, 0.5]]),
} as const satisfies Record<string, Play>;

export type SfxName = keyof typeof SFX;
