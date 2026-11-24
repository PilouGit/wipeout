import { createInstrument, createShared, type Instrument, type SynthShared } from './instruments';
import type { MusicOutput, PartDef, SoundFile } from './types';

interface PartBus {
  readonly gain: GainNode;
  /** Point d'entrée des voix ; remplacé par allNotesOff pour couper net les notes en cours. */
  voices: GainNode;
  readonly instrument: Instrument;
}

interface SoundBus {
  readonly gain: GainNode;
  readonly parts: Map<string, PartBus>;
}

const SOUND_RELEASE = 0.35;

/** Implémentation Web Audio de la sortie : un bus par son, un bus par partie, réverbe et écho par son. */
export class WebAudioOutput implements MusicOutput {
  private readonly sounds = new Map<number, SoundBus>();
  private readonly shared: SynthShared;
  private readonly impulse: AudioBuffer;

  /** @param reverbSeconds durée de la réverbération (son coût de convolution lui est proportionnel) */
  constructor(private readonly ctx: AudioContext, private readonly destination: AudioNode, reverbSeconds = 2.8) {
    this.shared = createShared(ctx);
    this.impulse = makeImpulse(ctx, reverbSeconds);
  }

  now(): number {
    return this.ctx.currentTime;
  }

  createSound(soundId: number, file: SoundFile): void {
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.destination);

    const reverb = ctx.createConvolver();
    reverb.buffer = this.impulse;
    reverb.connect(gain);

    // écho à la croche pointée, filtré dans la boucle de réinjection
    const delay = ctx.createDelay(2);
    delay.delayTime.value = (60 / file.bpm) * 0.75;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.38;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2600;
    delay.connect(tone).connect(feedback).connect(delay);
    tone.connect(gain);

    const parts = new Map<string, PartBus>();
    for (const def of file.parts) {
      const partGain = ctx.createGain();
      const panner = ctx.createStereoPanner();
      panner.pan.value = def.pan ?? 0;
      partGain.connect(panner).connect(gain);
      if (def.reverb) panner.connect(send(ctx, def.reverb)).connect(reverb);
      if (def.delay) panner.connect(send(ctx, def.delay)).connect(delay);
      const voices = ctx.createGain();
      voices.connect(partGain);
      parts.set(def.name, { gain: partGain, voices, instrument: createInstrument(def.instrument, ctx, voices, this.shared) });
    }
    this.sounds.set(soundId, { gain, parts });
  }

  destroySound(soundId: number, time: number): void {
    const bus = this.sounds.get(soundId);
    if (!bus) return;
    this.sounds.delete(soundId);
    const t = Math.max(time, this.ctx.currentTime);
    bus.gain.gain.cancelScheduledValues(t);
    bus.gain.gain.setTargetAtTime(0, t, SOUND_RELEASE / 4);
    const delayMs = (t - this.ctx.currentTime + SOUND_RELEASE + 3) * 1000;
    setTimeout(() => bus.gain.disconnect(), delayMs);
  }

  note(soundId: number, part: PartDef, time: number, note: number, velocity: number, duration: number, slide: boolean): void {
    this.sounds.get(soundId)?.parts.get(part.name)?.instrument.play(Math.max(time, this.ctx.currentTime), note, velocity, duration, slide);
  }

  setPartGain(soundId: number, part: string, gain: number, time: number): void {
    const p = this.sounds.get(soundId)?.parts.get(part);
    p?.gain.gain.setTargetAtTime(gain, Math.max(time, this.ctx.currentTime), 0.015);
  }

  setSoundGain(soundId: number, gain: number, time: number): void {
    this.sounds.get(soundId)?.gain.gain.setTargetAtTime(gain, Math.max(time, this.ctx.currentTime), 0.03);
  }

  controller(soundId: number, part: string, controller: number, value: number, time: number): void {
    this.sounds.get(soundId)?.parts.get(part)?.instrument.control(controller, value, time);
  }

  allNotesOff(soundId: number, time: number): void {
    const bus = this.sounds.get(soundId);
    if (!bus) return;
    const t = Math.max(time, this.ctx.currentTime);
    for (const p of bus.parts.values()) {
      const old = p.voices;
      old.gain.setTargetAtTime(0, t, 0.01);
      setTimeout(() => old.disconnect(), (t - this.ctx.currentTime + 0.2) * 1000);
      p.voices = this.ctx.createGain();
      p.voices.connect(p.gain);
      p.instrument.output = p.voices;
    }
  }
}

function send(ctx: AudioContext, amount: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = amount;
  return g;
}

/** Réponse impulsionnelle synthétique : bruit stéréo à décroissance exponentielle. */
function makeImpulse(ctx: AudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
  }
  return buf;
}
