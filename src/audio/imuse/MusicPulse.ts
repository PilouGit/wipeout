import { BEATS_PER_BAR, MAX_VOLUME, type InstrumentId, type MusicalClock, type MusicOutput, type PartDef, type SoundFile } from './types';

/** Familles d'instruments suivies par les visuels. */
export type Band = 'kick' | 'snare' | 'hat' | 'bass' | 'lead' | 'pad' | 'impact';
export const BANDS: readonly Band[] = ['kick', 'snare', 'hat', 'bass', 'lead', 'pad', 'impact'];

const BAND_OF: Readonly<Record<InstrumentId, Band | null>> = {
  kick: 'kick', snare: 'snare', clap: 'snare', hat: 'hat', openhat: 'hat', perc: 'hat',
  acid: 'bass', reese: 'bass', stab: 'lead', pluck: 'lead', lead: 'lead', pad: 'pad',
  riser: null, impact: 'impact', alarm: 'lead', growl: 'lead',
};

/** Constante de temps de décroissance de chaque enveloppe (s). */
const DECAY: Readonly<Record<Band, number>> = {
  kick: 0.16, snare: 0.18, hat: 0.07, bass: 0.22, lead: 0.3, pad: 1.4, impact: 0.6,
};

/** Nombre d'attaques de kick mémorisées (ondes simultanées au sol). */
export const WAVE_COUNT = 4;
/** Au-delà, une note en attente est jugée périmée (son coupé, pause...). */
const STALE = 1;

/** Instantané de la musique à un instant donné, prêt à piloter des visuels. */
export interface MusicFeatures {
  /** Enveloppes 0..1 par famille d'instruments. */
  readonly env: Readonly<Record<Band, number>>;
  /** Dernière note (MIDI) jouée par la basse / la mélodie. */
  readonly bassNote: number;
  readonly leadNote: number;
  /** Âge (s) et force des dernières attaques de kick/impact, les plus récentes d'abord. */
  readonly waveAge: readonly number[];
  readonly waveStrength: readonly number[];
  /** Densité d'orchestration : part des parties audibles, pondérée par leur trim, 0..1. */
  readonly energy: number;
  /** Volume global de la musique (fondus, ducking), 0..1. */
  readonly level: number;
  /** Horloge musicale du son dominant, ou null en silence. */
  readonly clock: MusicalClock | null;
  /** Compteur de temps continu (croissant même à travers les sauts) : phase des animations. */
  readonly beats: number;
}

interface PendingNote {
  readonly sound: number;
  readonly band: Band;
  readonly time: number;
  readonly note: number;
  /** 0..1 */
  readonly velocity: number;
}

/**
 * Prise d'écoute sur la sortie d'iMUSE : relaie tout à la vraie sortie et note au passage
 * les notes planifiées (avec leur date audio) et les gains des parties. `sample()` rejoue
 * ces informations à l'heure audio réelle et en tire des enveloppes par famille
 * d'instruments — sans analyse spectrale, donc parfaitement calé sur la partition.
 */
export class MusicPulse implements MusicOutput {
  private pending: PendingNote[] = [];
  private readonly env: Record<Band, number> = { kick: 0, snare: 0, hat: 0, bass: 0, lead: 0, pad: 0, impact: 0 };
  private readonly partGain = new Map<string, number>();
  private readonly partBand = new Map<string, Band | null>();
  private readonly partTrim = new Map<string, number>();
  private readonly soundGain = new Map<number, number>();
  private readonly waves: { time: number; strength: number }[] = [];
  private bassNote = 48;
  private leadNote = 72;
  private lastSample: number;
  private beats = 0;
  private lastClock: MusicalClock | null = null;

  constructor(private readonly inner: MusicOutput) {
    this.lastSample = inner.now();
  }

  // ------------------------------------------------------------------ MusicOutput (relais)

  now(): number {
    return this.inner.now();
  }

  createSound(soundId: number, file: SoundFile): void {
    for (const p of file.parts) {
      this.partBand.set(key(soundId, p.name), BAND_OF[p.instrument]);
      this.partTrim.set(key(soundId, p.name), p.volume / MAX_VOLUME);
    }
    this.inner.createSound(soundId, file);
  }

  destroySound(soundId: number, time: number): void {
    this.dropPending(soundId, time);
    this.soundGain.delete(soundId);
    for (const k of [...this.partGain.keys()]) if (k.startsWith(`${soundId}:`)) this.partGain.delete(k);
    this.inner.destroySound(soundId, time);
  }

  /** Notes envoyées au synthétiseur depuis le début (mesure de charge audio). */
  notesSent = 0;

  note(soundId: number, part: PartDef, time: number, note: number, velocity: number, duration: number, slide: boolean): void {
    this.notesSent++;
    const band = BAND_OF[part.instrument];
    if (band) this.pending.push({ sound: soundId, band, time, note, velocity: velocity / MAX_VOLUME });
    this.inner.note(soundId, part, time, note, velocity, duration, slide);
  }

  setPartGain(soundId: number, part: string, gain: number, time: number): void {
    this.partGain.set(key(soundId, part), gain);
    this.inner.setPartGain(soundId, part, gain, time);
  }

  setSoundGain(soundId: number, gain: number, time: number): void {
    this.soundGain.set(soundId, gain);
    this.inner.setSoundGain(soundId, gain, time);
  }

  controller(soundId: number, part: string, controller: number, value: number, time: number): void {
    this.inner.controller(soundId, part, controller, value, time);
  }

  allNotesOff(soundId: number, time: number): void {
    this.dropPending(soundId, time);
    this.inner.allNotesOff(soundId, time);
  }

  // ------------------------------------------------------------------ analyse

  /** Fait avancer les enveloppes jusqu'à maintenant. `clock` : horloge du son dominant (IMuse.clock). */
  sample(clock: MusicalClock | null): MusicFeatures {
    const now = this.inner.now();
    const dt = Math.max(0, now - this.lastSample);
    this.lastSample = now;

    for (const b of BANDS) this.env[b] *= Math.exp(-dt / DECAY[b]);

    const due: PendingNote[] = [];
    this.pending = this.pending.filter((n) => {
      if (n.time > now) return true;
      if (now - n.time < STALE) due.push(n);
      return false;
    });
    due.sort((a, b) => a.time - b.time);
    for (const n of due) {
      const gain = (this.soundGain.get(n.sound) ?? 0) > 0 ? 1 : 0;
      if (!gain) continue;
      // l'enveloppe part de l'attaque, déjà vieillie du retard de lecture
      const v = n.velocity * Math.exp(-(now - n.time) / DECAY[n.band]);
      this.env[n.band] = Math.min(1, Math.max(this.env[n.band], v));
      if (n.band === 'bass') this.bassNote = n.note;
      else if (n.band === 'lead') this.leadNote = n.note;
      if (n.band === 'kick' || n.band === 'impact') {
        this.waves.unshift({ time: n.time, strength: n.band === 'impact' ? 1.6 : n.velocity });
        this.waves.length = Math.min(this.waves.length, WAVE_COUNT);
      }
    }

    // compteur de temps continu : on intègre le tempo, et on se recale en douceur sur la phase réelle
    if (clock) {
      this.beats += dt * clock.beatsPerSecond;
      const target = clock.beat;
      const frac = ((this.beats % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR;
      let err = target - frac;
      if (err > BEATS_PER_BAR / 2) err -= BEATS_PER_BAR;
      if (err < -BEATS_PER_BAR / 2) err += BEATS_PER_BAR;
      this.beats += Math.abs(err) > 1 ? err : err * Math.min(1, dt * 8);
    } else {
      this.beats += dt * 0.5; // respiration lente en silence
    }
    this.lastClock = clock;

    let audible = 0;
    let total = 0;
    for (const [k, band] of this.partBand) {
      if (!band || !this.soundGain.has(soundOf(k))) continue;
      const trim = this.partTrim.get(k) ?? 0;
      total += trim;
      audible += Math.min(trim, this.partGain.get(k) ?? 0);
    }
    let level = 0;
    for (const g of this.soundGain.values()) level = Math.max(level, g);

    return {
      env: { ...this.env },
      bassNote: this.bassNote,
      leadNote: this.leadNote,
      waveAge: this.waves.map((w) => now - w.time),
      waveStrength: this.waves.map((w) => w.strength),
      energy: total > 0 ? audible / total : 0,
      level: Math.min(1, level),
      clock: this.lastClock,
      beats: this.beats,
    };
  }

  private dropPending(soundId: number, time: number): void {
    this.pending = this.pending.filter((n) => n.sound !== soundId || n.time < time);
  }
}

const key = (sound: number, part: string) => `${sound}:${part}`;
const soundOf = (k: string) => Number(k.slice(0, k.indexOf(':')));

/** Musique muette : avant l'initialisation audio (politique d'autoplay). */
export function silentFeatures(beats: number): MusicFeatures {
  return {
    env: { kick: 0, snare: 0, hat: 0, bass: 0, lead: 0, pad: 0, impact: 0 },
    bassNote: 48, leadNote: 72, waveAge: [], waveStrength: [], energy: 0, level: 0, clock: null, beats,
  };
}
