import { Fade, FADE_HZ } from './Fade';
import { GroupVolumes } from './GroupVolumes';
import { Player, type PlayerHost } from './Player';
import {
  BEATS_PER_BAR, MAX_VOLUME, TICKS_PER_BEAT,
  type Command, type FadeParam, type MusicalClock, type MusicalPosition, type MusicOutput, type SoundFile, type VolumeGroup,
} from './types';

/** Avance de planification : les notes sont envoyées à Web Audio un peu en avance. */
export const LOOKAHEAD = 0.15;
/** Nombre de sons simultanés ; au-delà, la priorité décide. */
export const MAX_SOUNDS = 4;
/** Au-delà de ce retard (s), le séquenceur se recale au lieu de rattraper. */
const MAX_LATENESS = 0.5;

interface Deferred {
  readonly at: number;
  readonly command: Command;
}

/**
 * Pilote de musique interactive façon iMUSE.
 *
 * Le jeu ne pilote jamais la musique « en direct » : il pose des valeurs de hooks,
 * met des commandes en attente de marqueurs (triggers) ou différées dans le temps,
 * et la partition décide *où* ces changements peuvent musicalement se produire.
 */
export class IMuse implements PlayerHost {
  readonly groups = new GroupVolumes();
  private readonly library = new Map<number, SoundFile>();
  private readonly players = new Map<number, Player>();
  private readonly triggers = new Map<string, Command[]>();
  private readonly deferred: Deferred[] = [];
  private fades: Fade[] = [];
  private pauseCount = 0;
  private pausedAt = 0;
  private fadeClock: number;

  constructor(readonly output: MusicOutput, sounds: readonly SoundFile[] = []) {
    for (const s of sounds) this.register(s);
    this.fadeClock = output.now();
  }

  register(file: SoundFile): void {
    this.library.set(file.id, file);
  }

  // ------------------------------------------------------------------ sons

  /** ImStartSound. `at` permet un départ calé sur un instant musical (trigger de marqueur). */
  startSound(sound: number, chunk?: number, at = this.output.now()): boolean {
    const file = this.library.get(sound);
    if (!file) throw new Error(`Son ${sound} non enregistré`);
    if (this.players.has(sound)) this.stopSound(sound, at);
    if (this.players.size >= MAX_SOUNDS && !this.evictFor(file.priority, at)) return false;
    const player = new Player(sound, file, chunk ?? file.startChunk, at, this);
    this.players.set(sound, player);
    this.applySoundGain(player, at);
    return true;
  }

  stopSound(sound: number, at = this.output.now()): void {
    this.players.get(sound)?.stop(at);
    this.players.delete(sound);
    this.fades = this.fades.filter((f) => f.sound !== sound);
  }

  stopAllSounds(at = this.output.now()): void {
    for (const s of [...this.players.keys()]) this.stopSound(s, at);
    this.triggers.clear();
    this.deferred.length = 0;
  }

  isPlaying(sound: number): boolean {
    return this.players.has(sound);
  }

  /** ImGetNextSound : itération sur les sons actifs. */
  activeSounds(): number[] {
    return [...this.players.keys()].sort((a, b) => a - b);
  }

  position(sound: number): MusicalPosition | null {
    return this.players.get(sound)?.position() ?? null;
  }

  /**
   * Horloge musicale d'un son à l'instant audio `at` (par défaut : maintenant) : sert aux visuels
   * synchronisés sur le tempo. null si le son ne joue pas.
   */
  clock(sound: number, at = this.output.now()): MusicalClock | null {
    const p = this.players.get(sound);
    if (!p) return null;
    const ticks = p.ticksAt(at);
    const beats = ticks / TICKS_PER_BEAT;
    return {
      chunk: p.chunkId,
      beat: ((beats % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR,
      bar: Math.floor(beats / BEATS_PER_BAR),
      beatsPerSecond: 1 / (p.secondsPerTick() * TICKS_PER_BEAT),
      transpose: p.transpose,
    };
  }

  // ------------------------------------------------------------------ hooks

  /** ImSetHook : la valeur sera comparée aux hooks de cette classe quand la lecture les atteindra. */
  setHook(sound: number, cls: string, value: number): void {
    this.players.get(sound)?.setHook(cls, value);
  }

  getHook(sound: number, cls: string): number {
    return this.players.get(sound)?.getHook(cls) ?? 0;
  }

  // ------------------------------------------------------------------ triggers & commandes

  /** ImSetTrigger : exécute `command` quand le son atteint le marqueur (une seule fois). */
  setTrigger(sound: number, marker: number, command: Command): void {
    const key = triggerKey(sound, marker);
    const list = this.triggers.get(key) ?? [];
    list.push(command);
    this.triggers.set(key, list);
  }

  checkTrigger(sound: number, marker: number): number {
    return this.triggers.get(triggerKey(sound, marker))?.length ?? 0;
  }

  clearTrigger(sound: number, marker: number): void {
    this.triggers.delete(triggerKey(sound, marker));
  }

  /** ImDeferCommand : exécute la commande dans `seconds` secondes (horloge audio, figée en pause). */
  deferCommand(seconds: number, command: Command): void {
    this.deferred.push({ at: this.output.now() + seconds, command });
  }

  /** Point d'entrée unique, comme SoundCall() : distribue une commande. */
  execute(command: Command, at = this.output.now()): void {
    switch (command.op) {
      case 'startSound':
        this.startSound(command.sound, command.chunk, at);
        break;
      case 'stopSound':
        this.stopSound(command.sound, at);
        break;
      case 'stopAllSounds':
        this.stopAllSounds(at);
        break;
      case 'setHook':
        this.setHook(command.sound, command.cls, command.value);
        break;
      case 'jump':
        this.players.get(command.sound)?.jump(command.chunk, command.tick ?? 0, command.sustain ?? true);
        break;
      case 'scan':
        this.players.get(command.sound)?.scan(command.chunk, command.tick);
        break;
      case 'fade':
        this.fade(command.sound, command.param, command.value, command.seconds);
        break;
      case 'setParam':
        this.setParam(command.sound, command.param, command.value, at);
        break;
      case 'sendMessage':
        if (this.players.has(command.sound)) this.output.controller(command.sound, command.part, command.controller, command.value, at);
        break;
      case 'setGroupVol':
        this.setGroupVol(command.group, command.volume);
        break;
    }
  }

  // ------------------------------------------------------------------ paramètres & fondus

  getParam(sound: number, param: FadeParam): number {
    const p = this.players.get(sound);
    if (!p) return 0;
    if (param === 'volume') return p.volume;
    if (param === 'speed') return p.speed;
    if (param === 'transpose') return p.transpose;
    return p.getPartTrim(param.slice(5));
  }

  setParam(sound: number, param: FadeParam, value: number, at = this.output.now()): void {
    const p = this.players.get(sound);
    if (!p) return;
    if (param === 'volume') {
      p.volume = Math.max(0, Math.min(MAX_VOLUME, value));
      this.applySoundGain(p, at);
    } else if (param === 'speed') p.speed = Math.max(1, Math.min(255, value));
    else if (param === 'transpose') p.transpose = value;
    else p.setPartTrim(param.slice(5), value, at);
  }

  /** ImFade : fondu entier à 60 Hz vers `value` en `seconds` secondes. Remplace un fondu en cours du même paramètre. */
  fade(sound: number, param: FadeParam, value: number, seconds: number): void {
    if (!this.players.has(sound)) return;
    this.fades = this.fades.filter((f) => !(f.sound === sound && f.param === param));
    this.fades.push(new Fade(sound, param, this.getParam(sound, param), value, seconds * FADE_HZ));
  }

  setGroupVol(group: VolumeGroup, volume: number): number {
    const old = this.groups.set(group, volume);
    const now = this.output.now();
    for (const p of this.players.values()) this.applySoundGain(p, now);
    return old;
  }

  // ------------------------------------------------------------------ pause (compteur imbriqué)

  /** ImPause : chaque appel doit être compensé par un resume(). */
  pause(): void {
    if (this.pauseCount++ > 0) return;
    this.pausedAt = this.output.now();
    for (const p of this.players.values()) {
      this.output.allNotesOff(p.sound, this.pausedAt);
      this.output.setSoundGain(p.sound, 0, this.pausedAt);
    }
  }

  resume(): void {
    if (this.pauseCount === 0) return;
    if (--this.pauseCount > 0) return;
    const now = this.output.now();
    const delta = now - this.pausedAt;
    for (const p of this.players.values()) {
      p.shiftTime(delta);
      this.applySoundGain(p, now);
    }
    for (let i = 0; i < this.deferred.length; i++) {
      const d = this.deferred[i];
      this.deferred[i] = { at: d.at + delta, command: d.command };
    }
    this.fadeClock = now;
  }

  get paused(): boolean {
    return this.pauseCount > 0;
  }

  // ------------------------------------------------------------------ horloge

  /** À appeler régulièrement (~25 ms) : fondus, commandes différées, planification des notes. */
  update(): void {
    const now = this.output.now();
    if (this.paused) return;

    const fadeSteps = Math.floor((now - this.fadeClock) * FADE_HZ);
    if (fadeSteps > 0) {
      this.fadeClock += fadeSteps / FADE_HZ;
      for (let i = 0; i < fadeSteps && this.fades.length; i++) this.stepFades(now);
    }

    for (let i = this.deferred.length - 1; i >= 0; i--) {
      if (this.deferred[i].at > now) continue;
      const { command } = this.deferred[i];
      this.deferred.splice(i, 1);
      this.execute(command, now);
    }

    for (const p of [...this.players.values()]) {
      // Un son en retard (onglet en arrière-plan, minuteries bridées) repart de maintenant
      // au lieu de rejouer d'un coup toutes les notes manquées. On mesure le retard sur le
      // *prochain* événement : un long silence écrit dans la partition n'est pas un retard.
      const late = now - p.nextEventTime();
      if (late > MAX_LATENESS) p.shiftTime(late);
      p.advance(now + LOOKAHEAD);
    }
  }

  // ------------------------------------------------------------------ PlayerHost

  onMarker(sound: number, marker: number, time: number): void {
    const key = triggerKey(sound, marker);
    const commands = this.triggers.get(key);
    if (!commands) return; // aucun trigger : la lecture continue sans interruption
    this.triggers.delete(key);
    for (const c of commands) this.execute(c, time);
  }

  onEnded(sound: number): void {
    this.players.delete(sound);
  }

  // ------------------------------------------------------------------ interne

  private stepFades(now: number): void {
    for (const f of this.fades) this.setParam(f.sound, f.param as FadeParam, f.step(), now);
    this.fades = this.fades.filter((f) => !f.finished);
  }

  private applySoundGain(p: Player, at: number): void {
    if (this.paused) return;
    this.output.setSoundGain(p.sound, (p.volume / MAX_VOLUME) * this.groups.musicGain(), at);
  }

  /** Libère la place du son le moins prioritaire s'il l'est moins que `priority`. */
  private evictFor(priority: number, at: number): boolean {
    let victim: Player | null = null;
    for (const p of this.players.values()) if (!victim || p.priority < victim.priority) victim = p;
    if (!victim || victim.priority >= priority) return false;
    this.stopSound(victim.sound, at);
    return true;
  }
}

const triggerKey = (sound: number, marker: number) => `${sound}:${marker}`;
