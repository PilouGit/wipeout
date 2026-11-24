import { CC_BRIGHTNESS, type InstrumentId } from './types';

/** Une voix d'instrument : reçoit des notes et des contrôleurs MIDI, joue vers `output`. */
export interface Instrument {
  output: AudioNode;
  play(time: number, note: number, velocity: number, duration: number, slide: boolean): void;
  control(controller: number, value: number, time: number): void;
}

export interface SynthShared {
  readonly noise: AudioBuffer;
  readonly drive: Float32Array<ArrayBuffer>;
}

export function createShared(ctx: BaseAudioContext): SynthShared {
  const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const drive = new Float32Array(new ArrayBuffer(1024 * 4));
  for (let i = 0; i < drive.length; i++) {
    const x = (i / (drive.length - 1)) * 2 - 1;
    drive[i] = Math.tanh(x * 3) / Math.tanh(3);
  }
  return { noise, drive };
}

export const mtof = (note: number): number => 440 * Math.pow(2, (note - 69) / 12);
const vel = (v: number) => v / 127;
const EPS = 0.0001;

/** Enveloppe attaque / maintien / relâchement sur un paramètre de gain. */
function adsr(p: AudioParam, t: number, peak: number, attack: number, hold: number, release: number, sustain = 1): number {
  p.setValueAtTime(EPS, t);
  p.linearRampToValueAtTime(peak, t + attack);
  p.setTargetAtTime(peak * sustain, t + attack, Math.max(0.01, hold / 3));
  const end = t + Math.max(attack, hold);
  p.setTargetAtTime(EPS, end, release / 4);
  return end + release;
}

/** Enveloppe percussive : attaque quasi instantanée puis décroissance exponentielle. */
function perc(p: AudioParam, t: number, peak: number, decay: number): number {
  p.setValueAtTime(EPS, t);
  p.linearRampToValueAtTime(peak, t + 0.002);
  p.exponentialRampToValueAtTime(EPS, t + decay);
  return t + decay + 0.02;
}

abstract class BaseInstrument implements Instrument {
  /** CC74, 0..127 */
  protected brightness = 64;

  constructor(protected readonly ctx: BaseAudioContext, public output: AudioNode, protected readonly shared: SynthShared) {}

  abstract play(time: number, note: number, velocity: number, duration: number, slide: boolean): void;

  control(controller: number, value: number): void {
    if (controller === CC_BRIGHTNESS) this.brightness = value;
  }

  protected noiseSource(t: number, until: number): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = this.shared.noise;
    s.start(t, Math.random() * 1.5);
    s.stop(until);
    return s;
  }

  protected osc(type: OscillatorType, freq: number, t: number, until: number, detune = 0): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.detune.value = detune;
    o.start(t);
    o.stop(until);
    return o;
  }

  protected filter(type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  /**
   * Branche la fin de la chaîne d'une note sur la sortie, et l'en débranche quand la source se tait.
   * Sans cela, filtres et gains d'une note restent dans le graphe (et calculés à chaque bloc)
   * jusqu'au passage du ramasse-miettes : des centaines de nœuds morts, de quoi faire décrocher
   * le thread audio d'un téléphone.
   */
  protected out(node: AudioNode, src: AudioScheduledSourceNode): void {
    node.connect(this.output);
    src.addEventListener('ended', () => node.disconnect(), { once: true });
  }

  protected gain(): GainNode {
    return this.ctx.createGain();
  }

  protected shaper(): WaveShaperNode {
    const w = this.ctx.createWaveShaper();
    w.curve = this.shared.drive;
    return w;
  }
}

// ------------------------------------------------------------------ batterie

class Kick extends BaseInstrument {
  play(t: number, _n: number, v: number): void {
    const g = this.gain();
    const end = perc(g.gain, t, vel(v) * 1.1, 0.45);
    const o = this.osc('sine', 170, t, end);
    o.frequency.exponentialRampToValueAtTime(50, t + 0.08);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.4);
    const sh = this.shaper();
    this.out(o.connect(g).connect(sh), o);
    const cg = this.gain();
    const cEnd = perc(cg.gain, t, vel(v) * 0.25, 0.012);
    const click = this.noiseSource(t, cEnd);
    this.out(click.connect(this.filter('highpass', 3000)).connect(cg), click);
  }
}

class Snare extends BaseInstrument {
  play(t: number, _n: number, v: number): void {
    const ng = this.gain();
    const end = perc(ng.gain, t, vel(v) * 0.55, 0.2);
    const n = this.noiseSource(t, end);
    this.out(n.connect(this.filter('bandpass', 1900, 0.8)).connect(ng), n);
    const tg = this.gain();
    const tEnd = perc(tg.gain, t, vel(v) * 0.45, 0.1);
    const o = this.osc('triangle', 190, t, tEnd);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.1);
    this.out(o.connect(tg), o);
  }
}

class Clap extends BaseInstrument {
  play(t: number, _n: number, v: number): void {
    const g = this.gain();
    const peak = vel(v) * 0.5;
    g.gain.setValueAtTime(EPS, t);
    for (const dt of [0, 0.011, 0.022]) {
      g.gain.setValueAtTime(peak, t + dt);
      g.gain.exponentialRampToValueAtTime(peak * 0.2, t + dt + 0.009);
    }
    g.gain.setValueAtTime(peak, t + 0.033);
    g.gain.exponentialRampToValueAtTime(EPS, t + 0.2);
    const n = this.noiseSource(t, t + 0.22);
    this.out(n.connect(this.filter('bandpass', 1200, 1.5)).connect(g), n);
  }
}

class Hat extends BaseInstrument {
  constructor(ctx: BaseAudioContext, out: AudioNode, shared: SynthShared, private readonly decay: number) {
    super(ctx, out, shared);
  }
  play(t: number, _n: number, v: number): void {
    const g = this.gain();
    const end = perc(g.gain, t, vel(v) * 0.22, this.decay);
    const n = this.noiseSource(t, end);
    this.out(n.connect(this.filter('highpass', 7200)).connect(this.filter('peaking', 10000, 1)).connect(g), n);
  }
}

/** Toms / congas accordés : donnent le côté « afro » aux breaks. */
class Perc extends BaseInstrument {
  play(t: number, n: number, v: number): void {
    const g = this.gain();
    const end = perc(g.gain, t, vel(v) * 0.5, 0.22);
    const f = mtof(n);
    const o = this.osc('sine', f * 1.5, t, end);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.04);
    this.out(o.connect(g), o);
  }
}

// ------------------------------------------------------------------ basses

/** Basse acide type TB-303 : dent de scie, passe-bas très résonant, accent et glissando. */
class Acid extends BaseInstrument {
  private lastFreq = 0;

  play(t: number, n: number, v: number, dur: number, slide: boolean): void {
    const freq = mtof(n);
    const accent = v > 110;
    const end = t + dur + 0.03;
    const o = this.osc('sawtooth', slide && this.lastFreq ? this.lastFreq : freq, t, end + 0.02);
    if (slide && this.lastFreq) o.frequency.exponentialRampToValueAtTime(freq, t + 0.07);
    this.lastFreq = freq;

    const base = 180 + (this.brightness / 127) * 1800;
    const f = this.filter('lowpass', base, accent ? 18 : 13);
    f.frequency.setValueAtTime(base * (accent ? 5 : 3), t);
    f.frequency.setTargetAtTime(base, t, slide ? 0.12 : 0.06);

    const g = this.gain();
    g.gain.setValueAtTime(EPS, t);
    g.gain.linearRampToValueAtTime(vel(v) * (accent ? 0.38 : 0.28), t + 0.004);
    g.gain.setValueAtTime(vel(v) * (accent ? 0.38 : 0.28), t + dur);
    g.gain.linearRampToValueAtTime(EPS, end);
    this.out(o.connect(f).connect(this.shaper()).connect(g), o);
  }
}

/** Basse « reese » : dents de scie désaccordées + sous-basse sinusoïdale. */
class Reese extends BaseInstrument {
  play(t: number, n: number, v: number, dur: number): void {
    const g = this.gain();
    const end = adsr(g.gain, t, vel(v) * 0.26, 0.01, dur, 0.12);
    const freq = mtof(n);
    const f = this.filter('lowpass', 250 + (this.brightness / 127) * 900, 2);
    for (const d of [-14, 14]) this.osc('sawtooth', freq, t, end, d).connect(f);
    const sub = this.gain();
    sub.gain.value = 0.9;
    const s = this.osc('sine', freq / 2, t, end);
    s.connect(sub).connect(g);
    f.connect(g);
    this.out(g, s);
  }
}

// ------------------------------------------------------------------ harmonie & mélodie

class Stab extends BaseInstrument {
  play(t: number, n: number, v: number): void {
    const g = this.gain();
    const end = perc(g.gain, t, vel(v) * 0.11, 0.32);
    const f = this.filter('lowpass', 400, 4);
    f.frequency.setValueAtTime(1200 + this.brightness * 30, t);
    f.frequency.exponentialRampToValueAtTime(380, t + 0.22);
    const freq = mtof(n);
    for (const d of [-9, 9]) this.osc('sawtooth', freq, t, end, d).connect(f);
    const s = this.osc('square', freq / 2, t, end);
    s.connect(f);
    this.out(f.connect(g), s);
  }
}

class Pad extends BaseInstrument {
  play(t: number, n: number, v: number, dur: number): void {
    const g = this.gain();
    const end = adsr(g.gain, t, vel(v) * 0.075, 0.7, dur, 1.2, 0.85);
    const freq = mtof(n);
    const f = this.filter('lowpass', 700 + this.brightness * 10, 1);
    for (const d of [-11, 0, 11]) this.osc('sawtooth', freq, t, end, d).connect(f);
    const s = this.osc('triangle', freq * 2, t, end);
    s.connect(f);
    this.out(f.connect(g), s);
  }
}

class Pluck extends BaseInstrument {
  play(t: number, n: number, v: number): void {
    const g = this.gain();
    const end = perc(g.gain, t, vel(v) * 0.1, 0.3);
    const f = this.filter('lowpass', 600, 5);
    f.frequency.setValueAtTime(1500 + this.brightness * 35, t);
    f.frequency.exponentialRampToValueAtTime(500, t + 0.18);
    const freq = mtof(n);
    this.osc('sawtooth', freq, t, end, -6).connect(f);
    const s = this.osc('square', freq, t, end, 6);
    s.connect(f);
    this.out(f.connect(g), s);
  }
}

class Lead extends BaseInstrument {
  play(t: number, n: number, v: number, dur: number): void {
    const g = this.gain();
    const end = adsr(g.gain, t, vel(v) * 0.1, 0.012, dur, 0.15, 0.9);
    const freq = mtof(n);
    const f = this.filter('lowpass', 1800 + this.brightness * 14, 2);
    const vib = this.osc('sine', 5.5, t, end);
    const depth = this.gain();
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(9, t + 0.35);
    vib.connect(depth);
    for (const [type, d] of [['sawtooth', -5], ['square', 5]] as const) {
      const o = this.osc(type, freq, t, end, d);
      depth.connect(o.detune);
      o.connect(f);
    }
    this.out(f.connect(g), vib);
  }
}

// ------------------------------------------------------------------ effets

/**
 * Rugissement de dragon : scies désaccordées saturées, hauteur qui plonge en fin de note,
 * filtre passe-bande « gorge » modulé par un trémolo rugueux.
 */
class Growl extends BaseInstrument {
  play(t: number, n: number, v: number, dur: number): void {
    const g = this.gain();
    const end = adsr(g.gain, t, vel(v) * 0.16, 0.03, dur, 0.25, 0.85);
    const freq = mtof(n);
    const f = this.filter('bandpass', 500 + this.brightness * 8, 1.6);
    f.frequency.setValueAtTime(380, t);
    f.frequency.exponentialRampToValueAtTime(900 + this.brightness * 10, t + Math.min(0.12, dur * 0.4));
    f.frequency.exponentialRampToValueAtTime(320, end);
    const rough = this.osc('square', 31, t, end);
    const roughDepth = this.gain();
    roughDepth.gain.value = vel(v) * 0.07;
    rough.connect(roughDepth).connect(g.gain);
    const drive = this.shaper();
    for (const d of [-22, 0, 19]) {
      const o = this.osc('sawtooth', freq, t, end, d);
      // la note s'effondre d'une quarte en fin de souffle
      o.frequency.setValueAtTime(freq, t + dur * 0.6);
      o.frequency.exponentialRampToValueAtTime(freq * 0.75, end);
      o.connect(drive);
    }
    this.out(drive.connect(f).connect(g), rough);
  }
}


/** Montée de bruit filtré sur toute la durée de la note. */
class Riser extends BaseInstrument {
  play(t: number, _n: number, v: number, dur: number): void {
    const end = t + dur;
    const g = this.gain();
    g.gain.setValueAtTime(EPS, t);
    g.gain.exponentialRampToValueAtTime(vel(v) * 0.22, end);
    g.gain.linearRampToValueAtTime(EPS, end + 0.05);
    const f = this.filter('bandpass', 300, 5);
    f.frequency.exponentialRampToValueAtTime(8000, end);
    const n = this.noiseSource(t, end + 0.06);
    this.out(n.connect(f).connect(g), n);
  }
}

/** Impact : boom grave + crash. */
class Impact extends BaseInstrument {
  play(t: number, _n: number, v: number): void {
    const bg = this.gain();
    const bEnd = perc(bg.gain, t, vel(v) * 0.9, 1.4);
    const o = this.osc('sine', 70, t, bEnd);
    o.frequency.exponentialRampToValueAtTime(30, t + 1.2);
    this.out(o.connect(bg), o);
    const cg = this.gain();
    const cEnd = perc(cg.gain, t, vel(v) * 0.25, 1.8);
    const n = this.noiseSource(t, cEnd);
    this.out(n.connect(this.filter('highpass', 4500)).connect(cg), n);
  }
}

class Alarm extends BaseInstrument {
  play(t: number, n: number, v: number): void {
    const g = this.gain();
    const end = perc(g.gain, t, vel(v) * 0.05, 0.09);
    const o = this.osc('square', mtof(n), t, end);
    this.out(o.connect(this.filter('lowpass', 3000)).connect(g), o);
  }
}

export function createInstrument(id: InstrumentId, ctx: BaseAudioContext, output: AudioNode, shared: SynthShared): Instrument {
  switch (id) {
    case 'kick': return new Kick(ctx, output, shared);
    case 'snare': return new Snare(ctx, output, shared);
    case 'clap': return new Clap(ctx, output, shared);
    case 'hat': return new Hat(ctx, output, shared, 0.045);
    case 'openhat': return new Hat(ctx, output, shared, 0.28);
    case 'perc': return new Perc(ctx, output, shared);
    case 'acid': return new Acid(ctx, output, shared);
    case 'reese': return new Reese(ctx, output, shared);
    case 'stab': return new Stab(ctx, output, shared);
    case 'pad': return new Pad(ctx, output, shared);
    case 'pluck': return new Pluck(ctx, output, shared);
    case 'lead': return new Lead(ctx, output, shared);
    case 'riser': return new Riser(ctx, output, shared);
    case 'impact': return new Impact(ctx, output, shared);
    case 'alarm': return new Alarm(ctx, output, shared);
    case 'growl': return new Growl(ctx, output, shared);
  }
}
