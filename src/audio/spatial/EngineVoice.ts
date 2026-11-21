import type { Vector3 } from 'three';
import type { Reflection } from './AcousticWorld';
import { TAP_KINDS } from './AcousticWorld';
import { driveCurve, glide } from './dsp';

/** Atténuation de distance commune à toutes les sources (modèle « inverse »). */
export const REF_DISTANCE = 6;

export function createPanner(ctx: AudioContext, hrtf: boolean): PannerNode {
  return new PannerNode(ctx, {
    panningModel: hrtf ? 'HRTF' : 'equalpower',
    distanceModel: 'inverse',
    refDistance: REF_DISTANCE,
    rolloffFactor: 1,
    maxDistance: 5000,
  });
}

/** Gain appliqué par un panner « inverse » à distance d. */
const distanceGain = (d: number) => REF_DISTANCE / Math.max(REF_DISTANCE, d);

const SMOOTH = 0.03;

function setPosition(p: PannerNode, v: Vector3, t: number): void {
  glide(p.positionX, v.x, t, SMOOTH, 1e-5);
  glide(p.positionY, v.y, t, SMOOTH, 1e-5);
  glide(p.positionZ, v.z, t, SMOOTH, 1e-5);
}

interface Tap {
  readonly delay: DelayNode;
  readonly filter: BiquadFilterNode;
  readonly gain: GainNode;
  readonly panner: PannerNode;
}

/**
 * Réseau de réflexions précoces : une ligne à retard courte par paroi sondée,
 * filtrée (absorption de la paroi), atténuée, puis spatialisée au point d'impact.
 * Les retards suivent la géométrie en continu : leur variation produit le filtrage en peigne
 * mouvant d'une glissière qui défile, et les impulsions des poteaux donnent le flutter echo.
 */
export class ReflectionNetwork {
  readonly input: GainNode;
  private readonly taps: Tap[];

  constructor(ctx: AudioContext, destination: AudioNode, hrtf: boolean) {
    this.input = ctx.createGain();
    this.taps = TAP_KINDS.map(() => {
      const delay = ctx.createDelay(0.06);
      const filter = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 4000, Q: 0.9 });
      const gain = new GainNode(ctx, { gain: 0 });
      const panner = createPanner(ctx, hrtf);
      this.input.connect(delay).connect(filter).connect(gain).connect(panner).connect(destination);
      return { delay, filter, gain, panner };
    });
  }

  /**
   * @param refl réflexions calculées (même ordre que TAP_KINDS)
   * @param direct distance source → auditeur
   */
  update(refl: readonly Reflection[], listener: Vector3, direct: number, enabled: boolean, t: number): void {
    this.taps.forEach((tap, i) => {
      const r = refl[i];
      const on = enabled && r.gain > 0.002;
      // gain voulu = r.gain × atténuation du direct ; le panner applique déjà celle du point d'impact
      const g = on ? (r.gain * distanceGain(direct)) / distanceGain(r.point.distanceTo(listener)) : 0;
      glide(tap.gain.gain, Math.min(1.5, g), t, SMOOTH);
      if (!on) return;
      glide(tap.delay.delayTime, r.delay, t, 0.02);
      glide(tap.filter.frequency, r.cutoff, t, SMOOTH);
      setPosition(tap.panner, r.point, t);
    });
  }

  disconnect(): void {
    this.input.disconnect();
    for (const tap of this.taps) tap.panner.disconnect();
  }
}

export interface EngineParams {
  /** Vitesse / vitesse de pointe (0..~1.3). */
  readonly speed: number;
  readonly thrust: number;
  readonly airbrake: number;
  /** Facteur Doppler appliqué aux hauteurs (1 = aucun). */
  readonly doppler: number;
  /** 0 = dégagé, 1 = totalement occulté. */
  readonly occlusion: number;
  /** Envoi vers la réverbération (0..1). */
  readonly reverbSend: number;
  /** 0 coupe la voix (vaisseau détruit ou trop loin). */
  readonly level: number;
}

/**
 * Moteur anti-gravité d'un vaisseau, synthétisé :
 * dent de scie + triangle → passe-bas résonant → saturation, plus une turbine (bruit
 * passe-bande) et le souffle des aérofreins. Sortie en trois chemins : direct (occlusion + HRTF),
 * réflexions précoces, envoi de réverbération.
 */
/** Qualité d'une voix : coût CPU contre précision de la spatialisation. */
export interface VoiceQuality {
  /** HRTF sur le son direct (sinon panoramique égal-puissance, bien moins coûteux). */
  readonly hrtf: boolean;
  /** Réseau de réflexions : null = aucun, sinon HRTF ou non sur les réflexions. */
  readonly reflections: { readonly hrtf: boolean } | null;
  readonly oversample: OverSampleType;
}

export class EngineVoice {
  readonly reflections: ReflectionNetwork | null;
  private readonly saw: OscillatorNode;
  private readonly tri: OscillatorNode;
  private readonly lowpass: BiquadFilterNode;
  private readonly turbine: BiquadFilterNode;
  private readonly turbineGain: GainNode;
  private readonly air: BiquadFilterNode;
  private readonly airGain: GainNode;
  private readonly voice: GainNode;
  private readonly occlusionFilter: BiquadFilterNode;
  private readonly directGain: GainNode;
  private readonly panner: PannerNode;
  private readonly send: GainNode;
  private readonly sources: AudioScheduledSourceNode[];

  constructor(ctx: AudioContext, noise: AudioBuffer, buses: { engines: AudioNode; reverb: AudioNode }, quality: VoiceQuality) {
    this.saw = new OscillatorNode(ctx, { type: 'sawtooth', frequency: 50 });
    this.tri = new OscillatorNode(ctx, { type: 'triangle', frequency: 75, detune: 7 });
    this.lowpass = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 400, Q: 7 });
    const shaper = new WaveShaperNode(ctx, { curve: driveCurve(2.2), oversample: quality.oversample });
    const pre = new GainNode(ctx, { gain: 0.6 });
    this.saw.connect(pre);
    this.tri.connect(pre);
    pre.connect(this.lowpass).connect(shaper);

    const n1 = new AudioBufferSourceNode(ctx, { buffer: noise, loop: true });
    this.turbine = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 1200, Q: 6 });
    this.turbineGain = new GainNode(ctx, { gain: 0 });
    n1.connect(this.turbine).connect(this.turbineGain);

    const n2 = new AudioBufferSourceNode(ctx, { buffer: noise, loop: true, loopStart: 0.37 });
    this.air = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 2500, Q: 0.8 });
    this.airGain = new GainNode(ctx, { gain: 0 });
    n2.connect(this.air).connect(this.airGain);

    this.voice = new GainNode(ctx, { gain: 0 });
    shaper.connect(this.voice);
    this.turbineGain.connect(this.voice);
    this.airGain.connect(this.voice);

    // chemin direct : occlusion puis spatialisation HRTF
    this.occlusionFilter = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 18000, Q: 0.5 });
    this.directGain = new GainNode(ctx, { gain: 1 });
    this.panner = createPanner(ctx, quality.hrtf);
    this.voice.connect(this.occlusionFilter).connect(this.directGain).connect(this.panner).connect(buses.engines);
    // les réflexions partent avant l'occlusion : elles contournent l'obstacle
    this.reflections = quality.reflections ? new ReflectionNetwork(ctx, buses.engines, quality.reflections.hrtf) : null;
    if (this.reflections) this.voice.connect(this.reflections.input);
    this.send = new GainNode(ctx, { gain: 0 });
    this.voice.connect(this.send).connect(buses.reverb);

    this.sources = [this.saw, this.tri, n1, n2];
    for (const s of this.sources) s.start();
  }

  setPosition(position: Vector3, t: number): void {
    setPosition(this.panner, position, t);
  }

  set(p: EngineParams, t: number): void {
    const s = Math.max(0, p.speed);
    const pitch = p.doppler * (1 - 0.06 * p.airbrake);
    const f = (42 + 150 * Math.min(1.3, s)) * pitch;
    glide(this.saw.frequency, f, t, 0.04);
    glide(this.tri.frequency, f * 1.5, t, 0.04);
    glide(this.lowpass.frequency, Math.max(150, 280 + 2600 * s + 600 * p.thrust - 900 * p.airbrake) * p.doppler, t, 0.05);
    glide(this.lowpass.Q, 7 + 5 * p.airbrake, t, 0.05);
    glide(this.turbine.frequency, (900 + 3800 * s) * p.doppler, t, 0.05);
    glide(this.turbineGain.gain, 0.05 + 0.12 * s * (0.4 + 0.6 * p.thrust), t, 0.05);
    glide(this.air.frequency, (1500 + 2000 * s) * p.doppler, t, 0.05);
    glide(this.airGain.gain, 0.35 * p.airbrake * Math.min(1, s * 1.5), t, 0.04);
    glide(this.voice.gain, p.level * (0.16 + 0.1 * p.thrust + 0.06 * Math.min(1, s)), t, 0.06);
    // occlusion : coupe les aigus et baisse le direct
    glide(this.occlusionFilter.frequency, 18000 * Math.pow(600 / 18000, p.occlusion), t, 0.06);
    glide(this.directGain.gain, 1 - 0.55 * p.occlusion, t, 0.06);
    glide(this.send.gain, p.reverbSend, t, 0.1);
  }

  dispose(): void {
    for (const s of this.sources) s.stop();
    this.panner.disconnect();
    this.send.disconnect();
    this.reflections?.disconnect();
  }
}
