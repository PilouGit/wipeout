import { Vector3 } from 'three';
import type { Track } from '../../track/Track';
import { AcousticWorld, createReflections, dopplerRatio, type Reflection } from './AcousticWorld';
import { createNoise, kRate, tunnelImpulse } from './dsp';
import { createPanner, EngineVoice } from './EngineVoice';
import { SFX, type SfxContext, type SfxName } from './Sfx';

/** État d'une source sonore (un vaisseau) à fournir à chaque image. */
export interface SourceState {
  readonly id: number;
  /** Repère piste : abscisse, décalage latéral, hauteur au-dessus de la surface. */
  readonly s: number;
  readonly x: number;
  readonly lift: number;
  readonly position: Vector3;
  /** Vitesse monde (m/s), pour le Doppler. */
  readonly velocity: Vector3;
  readonly speed: number;
  readonly thrust: number;
  readonly airbrake: number;
  readonly active: boolean;
  readonly isPlayer: boolean;
}

export interface ListenerState {
  readonly position: Vector3;
  readonly forward: Vector3;
  readonly up: Vector3;
  /** Abscisse approximative de l'auditeur (pour l'enfermement : réverbération perçue). */
  readonly s: number;
}

export interface AudioFrame {
  readonly track: Track;
  readonly listener: ListenerState;
  readonly sources: readonly SourceState[];
  readonly dt: number;
}

export interface SpatialOptions {
  reflections: boolean;
  reverb: boolean;
  doppler: boolean;
  occlusion: boolean;
}

/** Banc d'essai : impose la vitesse et les aérofreins du moteur du joueur. */
export interface ManualOverride {
  enabled: boolean;
  speed: number;
  airbrake: number;
}

/** Ce qui a été calculé pour une source à la dernière image (pour la visualisation). */
export interface VoiceDebug {
  readonly id: number;
  readonly isPlayer: boolean;
  readonly position: Vector3;
  readonly reflections: Reflection[];
  occlusion: number;
  doppler: number;
  enclosure: number;
  audible: boolean;
}

export interface SpatialDebug {
  readonly listener: Vector3;
  listenerEnclosure: number;
  readonly voices: Map<number, VoiceDebug>;
}

interface Voice {
  readonly engine: EngineVoice;
  readonly debug: VoiceDebug;
  doppler: number;
}

/** Au-delà, une voix est coupée et n'est plus calculée. */
const AUDIBLE_RANGE = 350;
const DOPPLER_LIMITS = [0.6, 1.7] as const;
const DUCK_DEPTH = 0.8;

/**
 * Moteur audio de course : bruitages procéduraux spatialisés (HRTF), Doppler, réflexions
 * précoces sur les parois, réverbération de tunnel, occlusion et ducking.
 *
 * Utilisation (voir README) :
 *   const sfx = new WipeoutAudioEngine(ctx, destination);
 *   // à chaque image :
 *   sfx.update({ track, listener, sources, dt });
 *   // évènements :
 *   sfx.play('speedPad', { position, s });
 */
export class WipeoutAudioEngine {
  readonly options: SpatialOptions = { reflections: true, reverb: true, doppler: true, occlusion: true };
  readonly manual: ManualOverride = { enabled: false, speed: 0.6, airbrake: 0 };
  readonly debug: SpatialDebug = { listener: new Vector3(), listenerEnclosure: 0, voices: new Map() };

  private readonly out: GainNode;
  private readonly engines: GainNode;
  private readonly sfxBus: GainNode;
  private readonly uiBus: GainNode;
  private readonly reverbIn: GainNode;
  private readonly reverbShelf: BiquadFilterNode;
  private readonly noise: AudioBuffer;
  private readonly kit: SfxContext;
  private readonly voices = new Map<number, Voice>();
  private readonly worlds = new WeakMap<Track, AcousticWorld>();
  private world: AcousticWorld | null = null;

  private readonly lastListener = new Vector3();
  private readonly listenerVel = new Vector3();
  private hasListener = false;
  private readonly tmp = new Vector3();

  /**
   * @param lite qualité allégée (mobile) : HRTF et réflexions réservés au joueur,
   *             panoramique simple ailleurs, réverbération plus courte, pas de suréchantillonnage.
   */
  constructor(private readonly ctx: AudioContext, destination: AudioNode, private readonly lite = false) {
    this.noise = createNoise(ctx, 3);
    this.kit = { ctx, noise: this.noise };
    const limiter = new DynamicsCompressorNode(ctx, { threshold: -10, knee: 8, ratio: 6, attack: 0.003, release: 0.2 });
    this.out = new GainNode(ctx, { gain: 1 });
    this.out.connect(limiter).connect(destination);
    this.engines = new GainNode(ctx, { gain: 1 });
    this.sfxBus = new GainNode(ctx, { gain: 1 });
    this.uiBus = new GainNode(ctx, { gain: 0.9 });
    this.engines.connect(this.out);
    this.sfxBus.connect(this.out);
    this.uiBus.connect(this.out);

    // réverbération tardive : convolution d'une réponse de tunnel, graves renforcés sous terre
    this.reverbIn = new GainNode(ctx, { gain: 1 });
    const conv = new ConvolverNode(ctx, { buffer: tunnelImpulse(ctx, lite ? 1.3 : 2.4) });
    this.reverbShelf = new BiquadFilterNode(ctx, { type: 'lowshelf', frequency: 220, gain: 0 });
    const reverbOut = new GainNode(ctx, { gain: 0.55 });
    this.reverbIn.connect(conv).connect(this.reverbShelf).connect(reverbOut).connect(this.out);
    const l = ctx.listener;
    if (l.positionX) kRate(l.positionX, l.positionY, l.positionZ, l.forwardX, l.forwardY, l.forwardZ, l.upX, l.upY, l.upZ);
  }

  /** Monde acoustique d'un circuit (construit une fois). */
  worldFor(track: Track): AcousticWorld {
    let w = this.worlds.get(track);
    if (!w) this.worlds.set(track, (w = new AcousticWorld(track)));
    return w;
  }

  // ------------------------------------------------------------------ boucle

  update(frame: AudioFrame): void {
    const t = this.ctx.currentTime;
    const world = (this.world = this.worldFor(frame.track));
    this.updateListener(frame, t);
    const L = frame.listener.position;
    const encL = world.enclosure(frame.listener.s);
    this.debug.listenerEnclosure = encL;
    this.reverbShelf.gain.setTargetAtTime(this.options.reverb ? 9 * encL : 0, t, 0.2);

    const seen = new Set<number>();
    for (const src of frame.sources) {
      seen.add(src.id);
      const voice = this.voiceFor(src);
      const dbg = voice.debug;
      dbg.position.copy(src.position);
      const dist = src.position.distanceTo(L);
      dbg.audible = src.active && dist < AUDIBLE_RANGE;
      if (!dbg.audible) {
        voice.engine.set({ speed: 0, thrust: 0, airbrake: 0, doppler: 1, occlusion: 0, reverbSend: 0, level: 0 }, t);
        voice.engine.setActive(false);
        continue;
      }
      voice.engine.setActive(true);

      // réflexions précoces (sondes gauche / droite / haut / poteaux)
      const net = voice.engine.reflections;
      if (net && this.options.reflections) world.probe(src.s, src.x, src.lift, L, dbg.reflections);
      else for (const r of dbg.reflections) r.gain = 0;
      net?.update(dbg.reflections, L, dist, this.options.reflections, t);

      dbg.occlusion = this.options.occlusion && !src.isPlayer ? world.occlusion(src.position, L) : 0;
      dbg.enclosure = world.enclosure(src.s);
      voice.doppler = this.options.doppler ? this.dopplerFactor(src, L, voice.doppler) : 1;
      dbg.doppler = voice.doppler;

      const manual = src.isPlayer && this.manual.enabled;
      voice.engine.setPosition(src.position, t);
      voice.engine.set(
        {
          speed: manual ? this.manual.speed : src.speed,
          thrust: manual ? Math.min(1, this.manual.speed * 1.5) : src.thrust,
          airbrake: manual ? this.manual.airbrake : src.airbrake,
          doppler: voice.doppler,
          occlusion: dbg.occlusion,
          reverbSend: this.options.reverb ? 0.7 * dbg.enclosure : 0,
          level: 1,
        },
        t,
      );
    }
    for (const [id, voice] of this.voices) {
      if (seen.has(id)) continue;
      voice.engine.dispose();
      this.voices.delete(id);
      this.debug.voices.delete(id);
    }
  }

  /** Coupe tous les moteurs (menu, pause). */
  silence(): void {
    const t = this.ctx.currentTime;
    for (const v of this.voices.values()) v.engine.set({ speed: 0, thrust: 0, airbrake: 0, doppler: 1, occlusion: 0, reverbSend: 0, level: 0 }, t);
  }

  private updateListener(frame: AudioFrame, t: number): void {
    const { position: p, forward: f, up: u } = frame.listener;
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.setTargetAtTime(p.x, t, 0.02);
      l.positionY.setTargetAtTime(p.y, t, 0.02);
      l.positionZ.setTargetAtTime(p.z, t, 0.02);
      l.forwardX.setTargetAtTime(f.x, t, 0.02);
      l.forwardY.setTargetAtTime(f.y, t, 0.02);
      l.forwardZ.setTargetAtTime(f.z, t, 0.02);
      l.upX.setTargetAtTime(u.x, t, 0.02);
      l.upY.setTargetAtTime(u.y, t, 0.02);
      l.upZ.setTargetAtTime(u.z, t, 0.02);
    } else {
      // Firefox : l'auditeur n'expose que l'ancienne API (pas d'AudioParam)
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }
    // vitesse de l'auditeur par différence finie (remise à zéro sur téléportation de caméra)
    const dt = Math.max(1e-3, frame.dt);
    if (this.hasListener && p.distanceTo(this.lastListener) < 40) {
      this.tmp.subVectors(p, this.lastListener).divideScalar(dt);
      this.listenerVel.lerp(this.tmp, Math.min(1, dt * 10));
    } else this.listenerVel.set(0, 0, 0);
    this.lastListener.copy(p);
    this.hasListener = true;
    this.debug.listener.copy(p);
  }

  /**
   * Effet Doppler : f' = f · (c − v_auditeur·n) / (c − v_source·n), n allant de la source vers l'auditeur.
   * Lissé pour éviter les sauts de hauteur quand la caméra change.
   */
  private dopplerFactor(src: SourceState, L: Vector3, previous: number): number {
    if (src.position.distanceTo(L) < 0.5) return previous;
    const raw = dopplerRatio(src.position, src.velocity, L, this.listenerVel);
    const target = Math.min(DOPPLER_LIMITS[1], Math.max(DOPPLER_LIMITS[0], raw));
    return previous + (target - previous) * 0.3;
  }

  private voiceFor(src: SourceState): Voice {
    let v = this.voices.get(src.id);
    if (!v) {
      // HRTF sur les réflexions du joueur ; panoramique égal-puissance (moins coûteux) pour les autres.
      // En qualité allégée, seuls le son direct et les réflexions du joueur sont spatialisés finement.
      const quality = this.lite
        ? { hrtf: src.isPlayer, reflections: src.isPlayer ? { hrtf: false } : null, oversample: 'none' as const }
        : { hrtf: true, reflections: { hrtf: src.isPlayer }, oversample: '2x' as const };
      const engine = new EngineVoice(this.ctx, this.noise, { engines: this.engines, reverb: this.reverbIn }, quality);
      const debug: VoiceDebug = {
        id: src.id, isPlayer: src.isPlayer, position: new Vector3(), reflections: createReflections(),
        occlusion: 0, doppler: 1, enclosure: 0, audible: false,
      };
      v = { engine, debug, doppler: 1 };
      this.voices.set(src.id, v);
      this.debug.voices.set(src.id, debug);
    }
    return v;
  }

  // ------------------------------------------------------------------ bruitages

  /**
   * Joue un bruitage. Avec `at`, il est spatialisé (HRTF) et envoyé dans la réverbération
   * selon l'enfermement du lieu ; sans, il est joué « dans le casque » (interface).
   */
  play(name: SfxName, at?: { position: Vector3; s: number }, intensity = 1): void {
    const t = this.ctx.currentTime;
    let dest: AudioNode = this.uiBus;
    let panner: PannerNode | null = null;
    let send: GainNode | null = null;
    if (at) {
      panner = createPanner(this.ctx, !this.lite);
      panner.positionX.value = at.position.x;
      panner.positionY.value = at.position.y;
      panner.positionZ.value = at.position.z;
      panner.connect(this.sfxBus);
      const enc = this.world && this.options.reverb ? this.world.enclosure(at.s) : 0;
      if (enc > 0.01) {
        send = new GainNode(this.ctx, { gain: 0.8 * enc });
        panner.connect(send).connect(this.reverbIn);
      }
      dest = panner;
    }
    const duration = SFX[name](this.kit, dest, t, intensity);
    if (panner) {
      const p = panner;
      const s = send;
      setTimeout(() => {
        p.disconnect();
        s?.disconnect();
      }, (duration + 3) * 1000);
    }
    if (name === 'plasma' || name === 'missile' || name === 'shieldAlert') this.duck();
  }

  /** Sidechain : les moteurs baissent de 20 % le temps d'une alerte ou d'un tir. */
  duck(): void {
    const g = this.engines.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(DUCK_DEPTH, t, 0.015);
    g.setTargetAtTime(1, t + 0.25, 0.2);
  }
}
