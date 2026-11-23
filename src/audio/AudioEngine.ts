import { LITE } from '../core/device';
import { IMuse, LOOKAHEAD } from './imuse/IMuse';
import { MusicPulse, silentFeatures, type MusicFeatures } from './imuse/MusicPulse';
import { WebAudioOutput } from './imuse/WebAudioOutput';
import { buildThemes, hasAuthored, seedFor, seedFromUrl, STINGERS, themeFor } from './score';
import type { MusicalClock, SoundFile } from './imuse/types';
import type { BeatSample } from '../race/Groove';
import { WipeoutAudioEngine } from './spatial/WipeoutAudioEngine';

const MASTER_VOLUME = 0.55;
const MUSIC_TICK_MS = 25;
const CALIBRATION_KEY = 'wipeout.calibration';

function storedCalibration(): number {
  try {
    const v = Number(localStorage.getItem(CALIBRATION_KEY));
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

/**
 * Point d'entrée audio du jeu. Le contexte Web Audio n'existe qu'après init() (politique
 * d'autoplay) ; d'ici là `sfx` et `imuse` valent null. Aucun fichier audio : tout est synthétisé.
 * - `sfx` : moteurs, bruitages, spatialisation 3D et acoustique des circuits
 * - `imuse` : musique interactive
 */
export class AudioEngine {
  imuse: IMuse | null = null;
  /**
   * Thème de course de chaque circuit (écrit à la main ou généré à partir d'une graine,
   * cf. `?musique=` dans l'adresse).
   */
  readonly themes: Map<string, SoundFile>;
  /** Graine du thème de chaque circuit (null = thème écrit à la main). */
  readonly seeds = new Map<string, number | null>();
  /** Thème en cours (choisi par le directeur musical) : son dominant pour les visuels. */
  themeSound = 0;
  sfx: WipeoutAudioEngine | null = null;
  private ctx: AudioContext | null = null;
  private pulse: MusicPulse | null = null;
  private idleBeats = 0;
  private idleClock = performance.now();
  private master!: GainNode;
  private _muted = false;
  private _calibration = storedCalibration();

  constructor() {
    const seed = seedFromUrl(location.search);
    this.themes = buildThemes(seed);
    for (const c of this.themes.keys()) this.seeds.set(c, seed === null && hasAuthored(c) ? null : seedFor(c, seed));
  }

  /** Régénère le thème d'un circuit avec une autre graine (null = version écrite, s'il y en a une). */
  reseed(circuit: string, seed: number | null): SoundFile {
    const file = themeFor(circuit, seed);
    this.themes.set(circuit, file);
    this.seeds.set(circuit, seed === null && !hasAuthored(circuit) ? seedFor(circuit) : seed);
    this.imuse?.register(file);
    return file;
  }

  /** À appeler suite à une action utilisateur (politique d'autoplay des navigateurs). */
  init(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = (this.ctx = new AudioContext({ latencyHint: 'interactive' }));
    this.master = ctx.createGain();
    this.master.gain.value = this._muted ? 0 : MASTER_VOLUME;
    this.master.connect(ctx.destination);
    this.sfx = new WipeoutAudioEngine(ctx, this.master, LITE);
    const music = new GainNode(ctx, { gain: 0.85 });
    music.connect(this.master);
    const pulse = (this.pulse = new MusicPulse(new WebAudioOutput(ctx, music)));
    const imuse = (this.imuse = new IMuse(pulse, [...this.themes.values(), ...STINGERS]));
    setInterval(() => imuse.update(), MUSIC_TICK_MS);
  }

  /**
   * Ce que la musique est en train de faire, à l'heure audio : enveloppes par famille d'instruments,
   * attaques de kick, densité d'orchestration, horloge du tempo. Pour animer le décor.
   */
  musicFeatures(): MusicFeatures {
    const m = this.imuse;
    if (!m || !this.pulse) {
      const now = performance.now();
      this.idleBeats += ((now - this.idleClock) / 1000) * 0.5;
      this.idleClock = now;
      return silentFeatures(this.idleBeats);
    }
    // son dominant : le thème s'il joue, sinon le jingle en cours
    const sound = m.isPlaying(this.themeSound) ? this.themeSound : m.activeSounds().at(-1);
    return this.pulse.sample(sound === undefined || m.paused ? null : m.clock(sound));
  }

  /**
   * Retard propre au joueur (s), mesuré par l'écran de calibration : casque Bluetooth, téléviseur,
   * temps de réaction. S'ajoute à la latence de sortie annoncée par le navigateur (souvent sous-estimée).
   */
  get calibration(): number {
    return this._calibration;
  }

  set calibration(seconds: number) {
    this._calibration = Math.max(-0.1, Math.min(0.5, seconds));
    try {
      localStorage.setItem(CALIBRATION_KEY, String(this._calibration));
    } catch {
      /* stockage indisponible : réglage pour la session seulement */
    }
  }

  /** Latence de sortie annoncée par le navigateur (s). */
  get outputLatency(): number {
    return this.ctx ? this.ctx.outputLatency || this.ctx.baseLatency || 0 : 0;
  }

  /** Instant audio de ce que le joueur entend (et à quoi il réagit) maintenant. */
  heardTime(): number {
    return (this.ctx?.currentTime ?? 0) - this.outputLatency - this._calibration;
  }

  /**
   * Avance de l'ordonnanceur musical sur ce qu'entend le joueur (s) : une décision prise maintenant
   * (hook) ne peut plus toucher la musique entendue avant ce délai.
   */
  get schedulingLead(): number {
    return this.outputLatency + this._calibration + LOOKAHEAD + MUSIC_TICK_MS / 1000 + 0.02;
  }

  /** Horloge du thème à l'instant entendu (section comprise). */
  heardClock(): MusicalClock | null {
    const m = this.imuse;
    if (!m || !this.ctx || m.paused) return null;
    return m.clock(this.themeSound, this.heardTime());
  }

  /** Horloge audio du contexte (s) et sa correspondance avec `performance.now()` (ms). */
  contextTimeAt(perfMs: number): number | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const ts = ctx.getOutputTimestamp?.();
    if (!ts || ts.contextTime === undefined || ts.performanceTime === undefined || ts.performanceTime === 0) {
      return ctx.currentTime - (performance.now() - perfMs) / 1000;
    }
    // l'horodatage de sortie décrit ce qui sort des haut-parleurs : on le ramène à l'horloge d'ordonnancement
    return ts.contextTime + (perfMs - ts.performanceTime) / 1000 + this.outputLatency;
  }

  /** Contexte audio (null avant init). */
  get context(): AudioContext | null {
    return this.ctx;
  }

  /**
   * Position musicale *entendue* (horloge du thème décalée de la latence de sortie et du retard
   * calibré) : sert à juger les actions rythmiques du joueur. null hors musique ou en pause.
   */
  beatSample(): BeatSample | null {
    const c = this.heardClock();
    if (!c) return null;
    return { beats: c.bar * 4 + c.beat, inBar: c.beat, bps: c.beatsPerSecond };
  }

  /** Notes de musique envoyées au synthétiseur depuis le lancement. */
  get notesSent(): number {
    return this.pulse?.notesSent ?? 0;
  }

  /** Le contexte joue réellement (sur iOS il peut rester suspendu après le premier geste). */
  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  get muted(): boolean {
    return this._muted;
  }

  set muted(m: boolean) {
    this._muted = m;
    if (this.ctx) this.master.gain.value = m ? 0 : MASTER_VOLUME;
  }
}
