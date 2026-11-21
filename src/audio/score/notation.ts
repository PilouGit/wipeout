import {
  TICKS_PER_BAR, TICKS_PER_BEAT, TICKS_PER_STEP,
  type Chunk, type HookAction, type ScoreEvent,
} from '../imuse/types';

const STEPS_PER_BAR = TICKS_PER_BAR / TICKS_PER_STEP;
const PITCH_CLASS: Readonly<Record<string, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NOTE_RE = /^([A-G])([#b]?)(-?\d)$/;

/** "F2" → 41, "Ab3" → 56, "C#4" → 61 (Do4 = 60). */
export function noteNumber(name: string): number {
  const m = NOTE_RE.exec(name);
  if (!m) throw new Error(`Note invalide : ${name}`);
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return (Number(m[3]) + 1) * 12 + PITCH_CLASS[m[1]] + acc;
}

const DRUM_VELOCITY: Readonly<Record<string, number>> = { X: 127, x: 100, o: 55 };

const EVENT_RANK = { marker: 0, hook: 1, note: 2 } as const;

interface Range {
  /** Première mesure (incluse). */
  from?: number;
  /** Dernière mesure (exclue). */
  to?: number;
}

interface LineOptions extends Range {
  /** Transposition en demi-tons. */
  shift?: number;
  /** Fraction de la durée réellement tenue (défaut 0.9). */
  gate?: number;
  velocity?: number;
}

/**
 * Écriture d'un chunk en notation « tracker » : une double croche par caractère ou par jeton.
 * Les motifs sont répétés pour remplir la plage de mesures demandée.
 */
export class ChunkBuilder {
  private readonly events: ScoreEvent[] = [];
  private nextChunk: number | null;

  constructor(readonly id: number, readonly name: string, readonly bars: number) {
    this.nextChunk = id;
  }

  get length(): number {
    return this.bars * TICKS_PER_BAR;
  }

  /** Chunk joué à la fin (null = fin du son). Par défaut le chunk boucle sur lui-même. */
  then(next: number | null): this {
    this.nextChunk = next;
    return this;
  }

  /**
   * Batterie : un caractère par double croche — x normal, X accent, o note fantôme, . silence.
   * Les espaces sont ignorés ; le motif peut couvrir plusieurs mesures.
   */
  drums(part: string, pattern: string, opts: Range & { note?: number } = {}): this {
    const steps = pattern.replace(/\s+/g, '');
    const { from, to } = this.range(opts);
    for (let s = from * STEPS_PER_BAR, i = 0; s < to * STEPS_PER_BAR; s++, i++) {
      const v = DRUM_VELOCITY[steps[i % steps.length]];
      if (v) this.note(part, s * TICKS_PER_STEP, opts.note ?? 60, v, TICKS_PER_STEP);
    }
    return this;
  }

  /**
   * Ligne mélodique, un jeton par double croche :
   *   F2  note · Ab3! accentuée · C3~ glissée depuis la précédente · _ prolonge · - silence
   */
  line(part: string, text: string, opts: LineOptions = {}): this {
    const tokens = text.trim().split(/\s+/);
    const { from, to } = this.range(opts);
    const total = (to - from) * STEPS_PER_BAR;
    const at = (i: number) => tokens[i % tokens.length];
    for (let i = 0; i < total; i++) {
      const tok = at(i);
      if (tok === '_' || tok === '-') continue;
      const accent = tok.includes('!');
      const slide = tok.includes('~');
      let len = 1;
      while (i + len < total && at(i + len) === '_') len++;
      const tied = i + len < total && at(i + len).includes('~');
      const gate = tied ? 1 : opts.gate ?? 0.9;
      const tick = (from * STEPS_PER_BAR + i) * TICKS_PER_STEP;
      const note = noteNumber(tok.replace(/[!~]/g, '')) + (opts.shift ?? 0);
      const velocity = accent ? 127 : opts.velocity ?? 96;
      this.note(part, tick, note, velocity, len * TICKS_PER_STEP * gate, slide);
    }
    return this;
  }

  /** Accord tenu : plusieurs notes au même instant. */
  chord(part: string, bar: number, step: number, lengthSteps: number, notes: readonly string[], velocity = 96): this {
    const tick = (bar * STEPS_PER_BAR + step) * TICKS_PER_STEP;
    for (const n of notes) this.note(part, tick, noteNumber(n), velocity, lengthSteps * TICKS_PER_STEP);
    return this;
  }

  /** Arpège montant/descendant en doubles croches sur les notes données, répété sur [from, to). */
  arp(part: string, notes: readonly string[], opts: Range & { octaves?: number; velocity?: number; every?: number } = {}): this {
    const base = notes.map(noteNumber);
    const up: number[] = [];
    for (let o = 0; o < (opts.octaves ?? 2); o++) for (const n of base) up.push(n + 12 * o);
    const cycle = [...up, ...up.slice(1, -1).reverse()];
    const every = opts.every ?? 1;
    const { from, to } = this.range(opts);
    for (let s = from * STEPS_PER_BAR, i = 0; s < to * STEPS_PER_BAR; s += every, i++) {
      this.note(part, s * TICKS_PER_STEP, cycle[i % cycle.length], i % 4 === 0 ? 104 : opts.velocity ?? 80, TICKS_PER_STEP * every * 0.8);
    }
    return this;
  }

  /** Note isolée, position en (mesure, double croche). */
  hit(part: string, bar: number, step: number, note: string | number, velocity = 110, lengthSteps = 1): this {
    const n = typeof note === 'string' ? noteNumber(note) : note;
    return this.note(part, (bar * STEPS_PER_BAR + step) * TICKS_PER_STEP, n, velocity, lengthSteps * TICKS_PER_STEP);
  }

  hook(tick: number, cls: string, id: number, action: HookAction): this {
    this.events.push({ kind: 'hook', tick, cls, id, action });
    return this;
  }

  /** Le même hook à chaque frontière de mesure listée (0 = début du chunk, bars = fin). */
  hookAtBars(bars: readonly number[], cls: string, id: number, action: HookAction): this {
    for (const b of bars) this.hook(b * TICKS_PER_BAR, cls, id, action);
    return this;
  }

  /** Le même hook à chaque temps (noire), de la fin du 1er temps jusqu'à la fin du chunk. */
  hookEveryBeat(cls: string, id: number, action: HookAction): this {
    for (let t = TICKS_PER_BEAT; t <= this.length; t += TICKS_PER_BEAT) this.hook(t, cls, id, action);
    return this;
  }

  marker(tick: number, id: number): this {
    this.events.push({ kind: 'marker', tick, id });
    return this;
  }

  build(): Chunk {
    for (const ev of this.events) {
      if (ev.tick < 0 || ev.tick > this.length) throw new Error(`${this.name} : événement hors du chunk (tick ${ev.tick})`);
    }
    // tri stable : à tick égal, marqueurs puis hooks puis notes, dans l'ordre d'écriture
    const events = this.events
      .map((ev, i) => ({ ev, i }))
      .sort((a, b) => a.ev.tick - b.ev.tick || EVENT_RANK[a.ev.kind] - EVENT_RANK[b.ev.kind] || a.i - b.i)
      .map(({ ev }) => ev);
    return { id: this.id, name: this.name, bars: this.bars, length: this.length, events, next: this.nextChunk };
  }

  private note(part: string, tick: number, note: number, velocity: number, duration: number, slide = false): this {
    if (tick >= this.length) return this;
    this.events.push({ kind: 'note', tick, part, note, velocity, duration, slide: slide || undefined });
    return this;
  }

  private range(r: Range): { from: number; to: number } {
    return { from: r.from ?? 0, to: Math.min(r.to ?? this.bars, this.bars) };
  }
}

/** Liste des mesures 1..n (frontières de fin de mesure). */
export const barEnds = (bars: number): number[] => Array.from({ length: bars }, (_, i) => i + 1);
