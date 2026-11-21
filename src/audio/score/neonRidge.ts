/**
 * « Neon Ridge » — thème principal original, 138 BPM, Fa mineur.
 * Techno breakbeat dans l'esprit des bandes-son de course anti-gravité des années 90 :
 * breaks syncopés, basse acide, stabs d'accords, nappes et arpèges.
 *
 * Carte des sections (flèches = hooks de saut, entre parenthèses = où ils sont placés) :
 *
 *   INTRO ──GRID (chaque mesure)──▶ GRID ──CRUISE (chaque temps)──▶ CRUISE
 *   CRUISE ──DRIVE (mes. 4, 8)──▶ FILL_UP ─▶ DRIVE ──CRUISE (mes. 4, 8)──▶ CRUISE
 *   CRUISE / DRIVE ──BREAKDOWN (mes. 4, 8)──▶ BREAKDOWN ──CRUISE/DRIVE (toutes les 2 mes.)
 *   * ──FINAL (mes. 4, 8)──▶ FILL_FINAL (+2 demi-tons) ─▶ FINAL
 *   * ──FINISH (chaque mesure)──▶ OUTRO ─▶ [marqueur OUTRO_END] fin
 *
 * Dans CRUISE, DRIVE et FINAL, des hooks LAYER aux mesures 0, 2, 4, 6 règlent l'orchestration
 * (niveau 1 à 4) et des hooks TENSION à chaque mesure ajoutent ou retirent l'alarme.
 */
import type { PartDef, SoundFile } from '../imuse/types';
import { HOOK, JUMP, LAYER_LEVELS, MAIN, MARKER, SOUND, TENSION } from './ids';
import { barEnds, ChunkBuilder } from './notation';

const BPM = 138;

const PARTS: readonly PartDef[] = [
  { name: 'kick', instrument: 'kick', volume: 118, drum: true },
  { name: 'break', instrument: 'kick', volume: 104, drum: true },
  { name: 'snare', instrument: 'snare', volume: 100, drum: true, reverb: 0.12 },
  { name: 'clap', instrument: 'clap', volume: 88, drum: true, reverb: 0.2 },
  { name: 'hat', instrument: 'hat', volume: 84, drum: true, pan: 0.25 },
  { name: 'ohat', instrument: 'openhat', volume: 66, drum: true, pan: -0.2 },
  { name: 'perc', instrument: 'perc', volume: 80, drum: true, pan: -0.35, reverb: 0.2 },
  { name: 'acid', instrument: 'acid', volume: 98, delay: 0.16 },
  { name: 'sub', instrument: 'reese', volume: 104 },
  { name: 'stab', instrument: 'stab', volume: 90, reverb: 0.25, delay: 0.3 },
  { name: 'pad', instrument: 'pad', volume: 92, reverb: 0.55 },
  { name: 'arp', instrument: 'pluck', volume: 76, pan: 0.3, delay: 0.35, reverb: 0.2 },
  { name: 'lead', instrument: 'lead', volume: 86, delay: 0.28, reverb: 0.3 },
  { name: 'riser', instrument: 'riser', volume: 80, drum: true, reverb: 0.3 },
  { name: 'impact', instrument: 'impact', volume: 100, drum: true, reverb: 0.45 },
  { name: 'alarm', instrument: 'alarm', volume: 70, pan: 0.4, delay: 0.2, enabled: false },
];

/** Parties dont l'orchestration est pilotée par les hooks de section / LAYER. */
const LAYERED = ['kick', 'break', 'snare', 'clap', 'hat', 'ohat', 'perc', 'acid', 'sub', 'stab', 'pad', 'arp', 'lead'] as const;
type Layered = (typeof LAYERED)[number];

// ------------------------------------------------------------------ harmonie

const CHORDS = {
  Fm: ['F3', 'Ab3', 'C4', 'Eb4'],
  Db: ['Db3', 'F3', 'Ab3', 'C4'],
  Eb: ['Eb3', 'G3', 'Bb3', 'D4'],
  Bbm: ['Bb2', 'Db3', 'F3', 'Ab3'],
  C: ['C3', 'E3', 'G3', 'Bb3'],
} as const;
type ChordName = keyof typeof CHORDS;

/** Une harmonie par mesure, et la transposition de la basse par rapport à Fa. */
const PROGRESSION: readonly (readonly [ChordName, number])[] = [
  ['Fm', 0], ['Fm', 0], ['Db', -4], ['Db', -4], ['Eb', -2], ['Eb', -2], ['Bbm', 5], ['C', 7],
];

const octaveUp = (notes: readonly string[]) => notes.map((n) => n.replace(/(-?\d)$/, (d) => String(Number(d) + 1)));

// ------------------------------------------------------------------ motifs

const FOUR_ON_FLOOR = 'x...x...x...x...';
const BREAK_KICK = 'x.....x...x..... x.x.......x..x..';
const BREAK_SNARE = '....X..o.o..X..o ....X..o....X.oo';
const CLAP = '....x.......x...';
const HATS_8 = 'x.x.x.x.x.x.x.xo';
const HATS_16 = 'xoxoxoxoxoxoxoXo';
const OPEN_HATS = '..x...x...x...x.';
const CONGAS = 'C4 - G3 C4 - - G3 - C4 - G3 - - C4 G3 G3';

const ACID_A = 'F2! F2 F3 - Eb3~ F3 - C3 F2 - Ab2! Bb2 F3~ - C3 Eb3';
const ACID_B = 'F2! F3 F2 Eb3 F2 C3! F2 Ab3~ F2 F3 F2! Eb3 F2 Bb2 C3~ F3';
const SUB_CRUISE = 'F1 _ _ _ _ _ - F1 _ _ - F2 _ - C2 _';
const SUB_DRIVE = 'F1 - F1 F2 - F1 F1 - F1 - F1 F2 - F1 Eb2 -';
const SUB_DRONE = 'F1 _ _ _ _ _ _ _ _ _ _ _ _ _ _ _';
const ALARM = 'C6 - F6 - C6 - F6 - C6 - F6 - C6 - F6 -';

const LEAD: readonly string[] = [
  'C5 _ _ Ab4 _ _ F4 _ G4 _ Ab4 _ C5 _ Eb5 _',
  'Db5 _ _ C5 _ _ Ab4 _ _ _ F4 _ G4 _ _ _',
  'Eb5 _ _ Db5 _ _ C5 _ Bb4 _ C5 _ Db5 _ Eb5 _',
  'F5 _ _ _ _ _ Eb5 _ C5 _ _ _ _ _ - -',
  'Eb5 _ _ Bb4 _ _ G4 _ Bb4 _ Eb5 _ G5 _ F5 _',
  'Eb5 _ _ _ Db5 _ C5 _ Bb4 _ _ _ G4 _ _ _',
  'F5 _ _ Db5 _ _ Bb4 _ Db5 _ F5 _ Ab5 _ G5 _',
  'E5 _ _ _ G5 _ _ _ C5 _ _ _ _ _ - -',
];

const STAB_STEPS = [2, 6, 9, 12];

// ------------------------------------------------------------------ écriture par section

function progressionLine(b: ChunkBuilder, part: string, line: string, gate = 0.9, velocity = 96): void {
  PROGRESSION.forEach(([, shift], bar) => b.line(part, line, { from: bar, to: bar + 1, shift, gate, velocity }));
}

function pads(b: ChunkBuilder, velocity = 78): void {
  for (let bar = 0; bar < 8; bar += 2) {
    const [a] = PROGRESSION[bar];
    const [c] = PROGRESSION[bar + 1];
    if (a === c) b.chord('pad', bar, 0, 32, CHORDS[a], velocity);
    else {
      b.chord('pad', bar, 0, 16, CHORDS[a], velocity);
      b.chord('pad', bar + 1, 0, 16, CHORDS[c], velocity);
    }
  }
}

function stabs(b: ChunkBuilder): void {
  PROGRESSION.forEach(([name], bar) => {
    for (const step of STAB_STEPS) b.chord('stab', bar, step, 1, CHORDS[name], step === 2 ? 110 : 92);
  });
}

function arps(b: ChunkBuilder, every = 1, velocity = 78): void {
  PROGRESSION.forEach(([name], bar) => b.arp('arp', octaveUp(CHORDS[name]), { from: bar, to: bar + 1, every, velocity }));
}

function lead(b: ChunkBuilder): void {
  LEAD.forEach((line, bar) => b.line('lead', line, { from: bar, to: bar + 1, gate: 0.95, velocity: 100 }));
}

function partsOn(on: readonly Layered[]): Record<string, boolean> {
  return Object.fromEntries(LAYERED.map((p) => [p, on.includes(p)]));
}

/** Mise en place inconditionnelle au début d'une section (marqueur de section + parties actives). */
function header(b: ChunkBuilder, on: readonly Layered[], transpose: number | null = 0): void {
  b.marker(0, MARKER.SECTION_BASE + b.id);
  if (transpose !== null) b.hook(0, HOOK.SCORE, 0, { type: 'transpose', semitones: transpose });
  b.hook(0, HOOK.SCORE, 0, { type: 'parts', parts: partsOn(on) });
}

/** Hooks LAYER aux frontières de phrase (toutes les 2 mesures). */
function layers(b: ChunkBuilder, table: Readonly<Record<(typeof LAYER_LEVELS)[number], readonly Layered[]>>): void {
  for (const level of LAYER_LEVELS) b.hookAtBars([0, 2, 4, 6], HOOK.LAYER, level, { type: 'parts', parts: partsOn(table[level]) });
}

function tension(b: ChunkBuilder): void {
  const starts = Array.from({ length: b.bars }, (_, i) => i);
  b.hookAtBars(starts, HOOK.TENSION, TENSION.ON, { type: 'parts', parts: { alarm: true } });
  b.hookAtBars(starts, HOOK.TENSION, TENSION.OFF, { type: 'parts', parts: { alarm: false } });
  b.line('alarm', ALARM, { velocity: 90 });
}

function jumps(b: ChunkBuilder, atBars: readonly number[], targets: Readonly<Partial<Record<number, number>>>): void {
  for (const [value, chunk] of Object.entries(targets)) {
    b.hookAtBars(atBars, HOOK.JUMP, Number(value), { type: 'jump', chunk: chunk! });
  }
}

function finish(b: ChunkBuilder): void {
  b.hookAtBars(barEnds(b.bars), HOOK.JUMP, JUMP.FINISH, { type: 'jump', chunk: MAIN.OUTRO });
}

// ------------------------------------------------------------------ sections

function intro(): ChunkBuilder {
  const b = new ChunkBuilder(MAIN.INTRO, 'INTRO', 8);
  header(b, ['pad', 'sub', 'arp', 'hat', 'perc']);
  pads(b, 70);
  progressionLine(b, 'sub', SUB_DRONE, 0.95, 70);
  PROGRESSION.forEach(([name], bar) => bar >= 2 && b.arp('arp', octaveUp(CHORDS[name]), { from: bar, to: bar + 1, every: 2, velocity: 64 }));
  b.drums('hat', HATS_8, { from: 4 });
  b.line('perc', CONGAS, { from: 6 });
  b.hit('riser', 7, 0, 60, 90, 16);
  jumps(b, barEnds(8), { [JUMP.GRID]: MAIN.GRID });
  return b;
}

/** Grille de départ : tension croissante, sortie au temps près sur le « GO ». */
function grid(): ChunkBuilder {
  const b = new ChunkBuilder(MAIN.GRID, 'GRID', 2);
  header(b, ['kick', 'hat', 'sub', 'pad', 'snare']);
  b.drums('kick', FOUR_ON_FLOOR);
  b.drums('hat', HATS_16);
  b.line('sub', 'F1 - F1 - F1 - F1 - F1 - F1 - F1 - F1 -', { velocity: 90, gate: 0.6 });
  b.chord('pad', 0, 0, 32, CHORDS.Fm, 72);
  b.drums('snare', 'x.x.x.x.x.x.xxxx', { from: 1 });
  b.hit('riser', 0, 0, 60, 100, 32);
  b.hookEveryBeat(HOOK.JUMP, JUMP.CRUISE, { type: 'jump', chunk: MAIN.CRUISE });
  finish(b);
  return b;
}

function cruise(): ChunkBuilder {
  const b = new ChunkBuilder(MAIN.CRUISE, 'CRUISE', 8);
  header(b, ['break', 'snare', 'hat', 'sub', 'pad']);
  layers(b, {
    1: ['break', 'snare', 'hat', 'sub', 'pad'],
    2: ['break', 'snare', 'hat', 'sub', 'pad', 'acid'],
    3: ['break', 'snare', 'hat', 'ohat', 'perc', 'sub', 'pad', 'acid', 'stab'],
    4: ['break', 'snare', 'clap', 'hat', 'ohat', 'perc', 'sub', 'pad', 'acid', 'stab', 'arp'],
  });
  tension(b);
  b.drums('break', BREAK_KICK).drums('snare', BREAK_SNARE).drums('clap', CLAP).drums('hat', HATS_8).drums('ohat', OPEN_HATS);
  b.line('perc', CONGAS);
  progressionLine(b, 'acid', ACID_A, 0.55);
  progressionLine(b, 'sub', SUB_CRUISE, 0.9, 100);
  pads(b);
  stabs(b);
  arps(b);
  jumps(b, [4, 8], { [JUMP.DRIVE]: MAIN.FILL_UP, [JUMP.BREAKDOWN]: MAIN.BREAKDOWN, [JUMP.FINAL]: MAIN.FILL_FINAL });
  finish(b);
  return b;
}

function fillUp(): ChunkBuilder {
  const b = new ChunkBuilder(MAIN.FILL_UP, 'FILL_UP', 1).then(MAIN.DRIVE);
  header(b, ['kick', 'snare', 'sub', 'pad']);
  b.drums('kick', FOUR_ON_FLOOR);
  b.drums('snare', 'x.x.x.x.xxxxXXXX');
  b.line('sub', 'F1 _ _ _ _ _ _ _ F2 _ _ _ _ _ _ _', { velocity: 100 });
  b.chord('pad', 0, 0, 16, CHORDS.Fm, 80);
  b.hit('riser', 0, 0, 60, 110, 16);
  finish(b);
  return b;
}

function drive(): ChunkBuilder {
  const b = new ChunkBuilder(MAIN.DRIVE, 'DRIVE', 8);
  header(b, ['kick', 'snare', 'hat', 'ohat', 'sub', 'acid']);
  layers(b, {
    1: ['kick', 'snare', 'hat', 'ohat', 'sub', 'acid'],
    2: ['kick', 'snare', 'clap', 'hat', 'ohat', 'sub', 'acid', 'stab'],
    3: ['kick', 'snare', 'clap', 'hat', 'ohat', 'sub', 'acid', 'stab', 'lead', 'pad'],
    4: ['kick', 'break', 'snare', 'clap', 'hat', 'ohat', 'perc', 'sub', 'acid', 'stab', 'lead', 'pad', 'arp'],
  });
  tension(b);
  b.hit('impact', 0, 0, 36, 90);
  b.drums('kick', FOUR_ON_FLOOR).drums('break', BREAK_KICK).drums('snare', BREAK_SNARE).drums('clap', CLAP);
  b.drums('hat', HATS_16).drums('ohat', OPEN_HATS);
  b.line('perc', CONGAS);
  progressionLine(b, 'acid', ACID_B, 0.5);
  progressionLine(b, 'sub', SUB_DRIVE, 0.8, 104);
  pads(b, 64);
  stabs(b);
  arps(b, 1, 70);
  lead(b);
  jumps(b, [4, 8], { [JUMP.CRUISE]: MAIN.CRUISE, [JUMP.BREAKDOWN]: MAIN.BREAKDOWN, [JUMP.FINAL]: MAIN.FILL_FINAL });
  finish(b);
  return b;
}

/** Respiration : plus de batterie, la nappe et l'arpège portent la musique. */
function breakdown(): ChunkBuilder {
  const b = new ChunkBuilder(MAIN.BREAKDOWN, 'BREAKDOWN', 8);
  header(b, ['pad', 'arp', 'sub', 'hat', 'perc']);
  tension(b);
  pads(b, 88);
  arps(b, 1, 66);
  progressionLine(b, 'sub', SUB_DRONE, 0.95, 84);
  b.drums('hat', HATS_8, { from: 4 });
  b.line('perc', CONGAS, { from: 6 });
  b.hit('riser', 6, 0, 60, 100, 32);
  jumps(b, [2, 4, 6, 8], { [JUMP.CRUISE]: MAIN.CRUISE, [JUMP.DRIVE]: MAIN.FILL_UP, [JUMP.FINAL]: MAIN.FILL_FINAL });
  finish(b);
  return b;
}

/** Roulement avant le dernier tour ; la modulation d'un ton est écrite à la toute fin. */
function fillFinal(): ChunkBuilder {
  const b = new ChunkBuilder(MAIN.FILL_FINAL, 'FILL_FINAL', 1).then(MAIN.FINAL);
  header(b, ['kick', 'snare', 'perc', 'sub', 'pad']);
  b.drums('snare', 'xxxxxxxxXXXXXXXX');
  b.drums('kick', 'x...x...x.x.x.xx');
  b.line('perc', 'C5 - A4 - F4 - C4 - A3 - F3 - C3 - C3 -');
  b.line('sub', 'F1 _ _ _ _ _ _ _ _ _ _ _ _ _ _ _', { velocity: 100 });
  b.chord('pad', 0, 0, 16, CHORDS.C, 84);
  b.hit('riser', 0, 0, 60, 120, 16);
  b.hook(b.length, HOOK.SCORE, 0, { type: 'transpose', semitones: 2 });
  finish(b);
  return b;
}

/** Dernier tour : tout l'orchestre, un ton plus haut (la transposition vient de FILL_FINAL). */
function final(): ChunkBuilder {
  const b = new ChunkBuilder(MAIN.FINAL, 'FINAL', 8);
  header(b, ['kick', 'break', 'snare', 'clap', 'hat', 'ohat', 'perc', 'sub', 'acid', 'stab', 'lead', 'pad'], null);
  const all: Layered[] = ['kick', 'break', 'snare', 'clap', 'hat', 'ohat', 'perc', 'sub', 'acid', 'stab', 'lead', 'pad'];
  layers(b, { 1: all, 2: all, 3: [...all, 'arp'], 4: [...all, 'arp'] });
  tension(b);
  b.hit('impact', 0, 0, 36, 120);
  b.drums('kick', FOUR_ON_FLOOR).drums('break', BREAK_KICK).drums('snare', BREAK_SNARE).drums('clap', CLAP);
  b.drums('hat', HATS_16).drums('ohat', OPEN_HATS);
  b.line('perc', CONGAS);
  progressionLine(b, 'acid', ACID_B, 0.5);
  progressionLine(b, 'sub', SUB_DRIVE, 0.8, 108);
  pads(b, 70);
  stabs(b);
  arps(b, 1, 72);
  lead(b);
  finish(b);
  return b;
}

function outro(): ChunkBuilder {
  const b = new ChunkBuilder(MAIN.OUTRO, 'OUTRO', 2).then(null);
  header(b, ['pad', 'sub', 'lead'], null);
  b.hit('impact', 0, 0, 36, 127);
  b.chord('pad', 0, 0, 32, CHORDS.Fm, 90);
  b.line('sub', 'F1 _ _ _ _ _ _ _ _ _ _ _ _ _ _ _', { from: 0, to: 1, velocity: 96 });
  b.line('lead', 'F5 _ _ _ _ _ _ _ _ _ _ _ _ _ _ _', { from: 0, to: 1, velocity: 100 });
  b.marker(b.length, MARKER.OUTRO_END);
  return b;
}

export const NEON_RIDGE: SoundFile = {
  id: SOUND.MAIN,
  name: 'Neon Ridge',
  bpm: BPM,
  priority: 50,
  volume: 112,
  parts: PARTS,
  startChunk: MAIN.INTRO,
  chunks: [intro(), grid(), cruise(), fillUp(), drive(), breakdown(), fillFinal(), final(), outro()].map((b) => b.build()),
};
