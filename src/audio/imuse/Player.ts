import {
  MAX_VOLUME, NORMAL_SPEED, TICKS_PER_BAR, TICKS_PER_BEAT,
  type Chunk, type HookAction, type HookEvent, type MusicalPosition, type MusicOutput, type PartDef, type SoundFile,
} from './types';

interface PartState {
  readonly def: PartDef;
  enabled: boolean;
  /** 0..127 */
  trim: number;
}

/** Ce que le lecteur demande au pilote (IMuse). */
export interface PlayerHost {
  readonly output: MusicOutput;
  /** Un marqueur a été atteint à `time` : le pilote exécute les triggers en attente. */
  onMarker(sound: number, marker: number, time: number): void;
  /** Le son est arrivé au bout d'un chunk sans suite. */
  onEnded(sound: number, time: number): void;
}

/** Garde-fou contre les boucles de sauts inconditionnels. */
const MAX_EVENTS_PER_UPDATE = 20000;

/**
 * Couple séquenceur/lecteur d'un son actif : avance dans le temps musical,
 * envoie les notes à la sortie, évalue les hooks et signale les marqueurs.
 *
 * L'horloge est ancrée : (tick, time) = position musicale et instant audio du dernier
 * événement traité. Le tempo pouvant changer (vitesse, fondus), chaque événement est
 * daté à partir de l'ancre avec le tempo courant.
 */
export class Player {
  readonly priority: number;
  volume: number;
  speed = NORMAL_SPEED;
  transpose = 0;
  stopped = false;

  private chunk: Chunk;
  private cursor = 0;
  private tick = 0;
  private time: number;
  private readonly hooks = new Map<string, number>();
  private readonly parts = new Map<string, PartState>();

  constructor(
    readonly sound: number,
    readonly file: SoundFile,
    startChunk: number,
    startTime: number,
    private readonly host: PlayerHost,
  ) {
    this.priority = file.priority;
    this.volume = file.volume;
    this.chunk = this.chunkById(startChunk);
    this.time = startTime;
    for (const def of file.parts) this.parts.set(def.name, { def, enabled: def.enabled ?? true, trim: def.volume });
    host.output.createSound(sound, file);
    for (const p of this.parts.values()) this.applyPartGain(p, startTime);
  }

  // ------------------------------------------------------------------ état

  get chunkId(): number {
    return this.chunk.id;
  }

  /** Instant audio de l'ancre (dernier événement traité). */
  get anchorTime(): number {
    return this.time;
  }

  position(): MusicalPosition {
    const t = Math.floor(this.tick);
    return {
      chunk: this.chunk.id,
      measure: Math.floor(t / TICKS_PER_BAR),
      beat: Math.floor((t % TICKS_PER_BAR) / TICKS_PER_BEAT),
      tick: t % TICKS_PER_BEAT,
    };
  }

  setHook(cls: string, value: number): void {
    this.hooks.set(cls, value);
  }

  getHook(cls: string): number {
    return this.hooks.get(cls) ?? 0;
  }

  isPartEnabled(part: string): boolean {
    return this.part(part).enabled;
  }

  getPartTrim(part: string): number {
    return this.part(part).trim;
  }

  setPartTrim(part: string, trim: number, time: number): void {
    const p = this.part(part);
    p.trim = clampVol(trim);
    this.applyPartGain(p, time);
  }

  setPartEnabled(part: string, enabled: boolean, time: number): void {
    const p = this.part(part);
    p.enabled = enabled;
    this.applyPartGain(p, time);
  }

  /** Instant audio prévu du prochain événement (ou de la fin du chunk). */
  nextEventTime(): number {
    const ev = this.chunk.events[this.cursor];
    const evTick = ev ? ev.tick : this.chunk.length;
    return this.time + (evTick - this.tick) * this.secondsPerTick();
  }

  /** Décale l'ancre (reprise après une pause). */
  shiftTime(delta: number): void {
    this.time += delta;
  }

  secondsPerTick(): number {
    return (60 / (this.file.bpm * TICKS_PER_BEAT)) * (NORMAL_SPEED / Math.max(1, this.speed));
  }

  // ------------------------------------------------------------------ transport

  /**
   * MdJump : déplacement immédiat. Les notes qui sonnent continuent (sustain),
   * les notes de la destination déjà commencées ne sont pas rejouées.
   */
  jump(chunkId: number, tick = 0, sustain = true): void {
    if (!sustain) this.host.output.allNotesOff(this.sound, this.time);
    this.chunk = this.chunkById(chunkId);
    this.tick = Math.max(0, Math.min(tick, this.chunk.length));
    this.cursor = lowerBound(this.chunk, this.tick);
  }

  /**
   * MdScan : déplacement en appliquant tous les messages de configuration rencontrés
   * depuis le début du chunk (hooks inconditionnels de parties/transposition), sans jouer de notes.
   */
  scan(chunkId: number, tick: number): void {
    const chunk = this.chunkById(chunkId);
    for (const ev of chunk.events) {
      if (ev.tick >= tick) break;
      if (ev.kind === 'hook' && ev.action.type !== 'jump' && this.hookMatches(ev)) this.applyAction(ev.action, this.time);
    }
    this.jump(chunkId, tick, true);
  }

  /** Planifie tous les événements jusqu'à l'instant audio `until`. */
  advance(until: number): void {
    let guard = 0;
    while (!this.stopped && guard++ < MAX_EVENTS_PER_UPDATE) {
      const ev = this.chunk.events[this.cursor];
      const evTick = ev ? ev.tick : this.chunk.length;
      const evTime = this.time + (evTick - this.tick) * this.secondsPerTick();
      if (evTime > until) return;
      this.time = evTime;
      this.tick = evTick;

      if (!ev) {
        this.endOfChunk();
        continue;
      }
      this.cursor++;
      switch (ev.kind) {
        case 'note':
          this.playNote(ev.part, ev.note, ev.velocity, ev.duration, !!ev.slide);
          break;
        case 'marker':
          this.host.onMarker(this.sound, ev.id, this.time);
          break;
        case 'hook':
          if (this.hookMatches(ev)) {
            // un hook de saut est « consommé » : il ne se redéclenche pas au prochain passage
            if (ev.action.type === 'jump' && ev.id !== 0) this.hooks.set(ev.cls, 0);
            this.applyAction(ev.action, this.time);
          }
          break;
      }
    }
  }

  stop(time: number): void {
    if (this.stopped) return;
    this.stopped = true;
    this.host.output.destroySound(this.sound, time);
  }

  // ------------------------------------------------------------------ interne

  private hookMatches(ev: HookEvent): boolean {
    return ev.id === 0 || this.getHook(ev.cls) === ev.id;
  }

  private applyAction(action: HookAction, time: number): void {
    switch (action.type) {
      case 'jump':
        this.jump(action.chunk, action.tick ?? 0, action.sustain ?? true);
        break;
      case 'parts':
        for (const [name, on] of Object.entries(action.parts)) this.setPartEnabled(name, on, time);
        break;
      case 'partTrim':
        this.setPartTrim(action.part, action.trim, time);
        break;
      case 'transpose':
        this.transpose = action.semitones;
        break;
    }
  }

  private playNote(partName: string, note: number, velocity: number, durationTicks: number, slide: boolean): void {
    const p = this.part(partName);
    if (!p.enabled) return;
    const pitch = p.def.drum ? note : note + this.transpose;
    this.host.output.note(this.sound, p.def, this.time, pitch, velocity, durationTicks * this.secondsPerTick(), slide);
  }

  private endOfChunk(): void {
    const next = this.chunk.next;
    if (next === null) {
      this.host.onEnded(this.sound, this.time);
      this.stop(this.time);
      return;
    }
    this.chunk = this.chunkById(next);
    this.tick = 0;
    this.cursor = 0;
  }

  private applyPartGain(p: PartState, time: number): void {
    this.host.output.setPartGain(this.sound, p.def.name, p.enabled ? p.trim / MAX_VOLUME : 0, time);
  }

  private part(name: string): PartState {
    const p = this.parts.get(name);
    if (!p) throw new Error(`Partie inconnue « ${name} » dans ${this.file.name}`);
    return p;
  }

  private chunkById(id: number): Chunk {
    const c = this.file.chunks.find((ch) => ch.id === id);
    if (!c) throw new Error(`Chunk ${id} introuvable dans ${this.file.name}`);
    return c;
  }
}

function lowerBound(chunk: Chunk, tick: number): number {
  let lo = 0;
  let hi = chunk.events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (chunk.events[mid].tick < tick) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const clampVol = (v: number) => Math.max(0, Math.min(MAX_VOLUME, Math.round(v)));
