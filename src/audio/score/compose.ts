/**
 * Mise en partition d'un thème de course. Tous les thèmes (écrit à la main ou générés) partagent
 * la même architecture de sections et le même contrat de hooks avec le directeur musical :
 *
 *   INTRO ──GRID (chaque mesure)──▶ GRID ──CRUISE (chaque temps)──▶ CRUISE
 *   CRUISE ──DRIVE (mes. 4, 8)──▶ FILL_UP ─▶ DRIVE ──CRUISE (mes. 4, 8)──▶ CRUISE
 *   CRUISE / DRIVE ──BREAKDOWN (toutes les 2 mes.)──▶ BREAKDOWN ──CRUISE/DRIVE (toutes les 2 mes.)
 *   CRUISE / DRIVE / BREAKDOWN ──DROP (chaque mesure)──▶ FILL_UP ─▶ DRIVE   (drop calé sur le circuit)
 *   * ──FINAL (mes. 4, 8)──▶ FILL_FINAL (+modulation) ─▶ FINAL
 *   * ──FINISH (chaque mesure)──▶ OUTRO ─▶ [marqueur OUTRO_END] fin
 *
 * Dans CRUISE, DRIVE et FINAL, des hooks LAYER aux mesures 0, 2, 4, 6 règlent l'orchestration
 * (niveau 1 à 4) et des hooks TENSION à chaque mesure ajoutent ou retirent l'alarme.
 * Des hooks SPEED à chaque mesure ajoutent des couches rythmiques selon la vitesse du joueur.
 * Des hooks DRAGON à chaque mesure font entrer le rugissement des dragons quand ils sortent du sol.
 */
import type { PartDef, SoundFile } from '../imuse/types';
import { DRAGON, HOOK, JUMP, LAYER_LEVELS, MAIN, MARKER, SPEED, TENSION } from './ids';
import { barEnds, ChunkBuilder } from './notation';

/** Parties dont l'orchestration est pilotée par les hooks de section / LAYER. */
export const LAYERED = ['kick', 'break', 'snare', 'clap', 'hat', 'ohat', 'perc', 'acid', 'sub', 'stab', 'pad', 'arp', 'lead'] as const;
export type Layered = (typeof LAYERED)[number];

/** Couches rythmiques ajoutées par palier de vitesse. */
const SPEED_PARTS = ['hat16', 'roll', 'kick2', 'shaker'] as const;
const SPEED_LAYERS: Readonly<Record<number, readonly (typeof SPEED_PARTS)[number][]>> = {
  [SPEED.SLOW]: [],
  [SPEED.FAST]: ['hat16'],
  [SPEED.FASTER]: ['hat16', 'roll'],
  [SPEED.MAX]: ['hat16', 'roll', 'kick2', 'shaker'],
};
/** Parties du rugissement des dragons (hooks DRAGON). */
const DRAGON_PARTS = ['dragon', 'dragonhit'] as const;
/** Parties coupées en début de section, rallumées par leurs hooks. */
const HOOKED_PARTS = [...SPEED_PARTS, ...DRAGON_PARTS];

/** Matériau musical d'un thème : tout ce qui change d'un thème à l'autre. */
export interface ThemeMaterial {
  readonly id: number;
  readonly name: string;
  readonly bpm: number;
  readonly volume: number;
  /** Les 13 parties LAYERED + riser, impact, alarm (les couches de vitesse et du dragon sont ajoutées). */
  readonly parts: readonly PartDef[];
  readonly chords: Readonly<Record<string, readonly string[]>>;
  /** Une harmonie par mesure (8 mesures) et la transposition des lignes de basse par rapport à la tonique. */
  readonly progression: readonly (readonly [string, number])[];
  /** Accords de tonique et de dominante (grille, montées, outro). */
  readonly tonic: string;
  readonly dominant: string;
  /** Tonique aux octaves 1, 2 et 5 (« F1 », « F2 », « F5 »). */
  readonly root: { readonly low: string; readonly mid: string; readonly high: string };
  /** Modulation (demi-tons) avant le dernier tour. */
  readonly modulation: number;
  readonly drums: {
    readonly four: string;
    readonly breakKick: string;
    readonly breakSnare: string;
    readonly clap: string;
    readonly hats8: string;
    readonly hats16: string;
    readonly openHats: string;
    readonly hatRush: string;
    readonly roll: string;
    readonly kickSync: string;
  };
  readonly congas: string;
  readonly shaker: string;
  readonly acidA: string;
  readonly acidB: string;
  readonly subCruise: string;
  readonly subDrive: string;
  readonly subDrone: string;
  readonly alarm: string;
  /** Huit mesures de mélodie (notes absolues). */
  readonly lead: readonly string[];
  readonly stabSteps: readonly number[];
  /** Descente de percussions du roulement final. */
  readonly fillPerc: string;
  /** Rugissement des dragons : une mesure sur la tonique, attaque au premier temps (transposé avec la progression). */
  readonly dragon: string;
}

/** Ajoute les couches de vitesse et du dragon aux parties d'un thème. */
function allParts(base: readonly PartDef[]): PartDef[] {
  return [
    ...base,
    { name: 'hat16', instrument: 'hat', volume: 62, drum: true, pan: -0.3, enabled: false },
    { name: 'roll', instrument: 'snare', volume: 80, drum: true, reverb: 0.15, enabled: false },
    { name: 'kick2', instrument: 'kick', volume: 96, drum: true, enabled: false },
    { name: 'shaker', instrument: 'perc', volume: 58, drum: true, pan: 0.45, delay: 0.1, enabled: false },
    { name: 'dragon', instrument: 'growl', volume: 96, reverb: 0.45, delay: 0.25, enabled: false },
    { name: 'dragonhit', instrument: 'impact', volume: 92, drum: true, reverb: 0.5, enabled: false },
  ];
}

const octaveUp = (notes: readonly string[]) => notes.map((n) => n.replace(/(-?\d)$/, (d) => String(Number(d) + 1)));

/** Compose le thème complet (9 sections) à partir de son matériau. */
export function composeTheme(m: ThemeMaterial): SoundFile {
  const D = m.drums;
  const { low: R1, mid: R2, high: R5 } = m.root;
  const chord = (name: string) => m.chords[name];

  // ---------------------------------------------------------------- écriture par section

  const progressionLine = (b: ChunkBuilder, part: string, line: string, gate = 0.9, velocity = 96) =>
    m.progression.forEach(([, shift], bar) => b.line(part, line, { from: bar, to: bar + 1, shift, gate, velocity }));

  const pads = (b: ChunkBuilder, velocity = 78) => {
    for (let bar = 0; bar < 8; bar += 2) {
      const [a] = m.progression[bar];
      const [c] = m.progression[bar + 1];
      if (a === c) b.chord('pad', bar, 0, 32, chord(a), velocity);
      else {
        b.chord('pad', bar, 0, 16, chord(a), velocity);
        b.chord('pad', bar + 1, 0, 16, chord(c), velocity);
      }
    }
  };

  const stabs = (b: ChunkBuilder) =>
    m.progression.forEach(([name], bar) => {
      for (const step of m.stabSteps) b.chord('stab', bar, step, 1, chord(name), step === m.stabSteps[0] ? 110 : 92);
    });

  const arps = (b: ChunkBuilder, every = 1, velocity = 78) =>
    m.progression.forEach(([name], bar) => b.arp('arp', octaveUp(chord(name)), { from: bar, to: bar + 1, every, velocity }));

  const lead = (b: ChunkBuilder) => m.lead.forEach((line, bar) => b.line('lead', line, { from: bar, to: bar + 1, gate: 0.95, velocity: 100 }));

  const partsOn = (on: readonly Layered[]) => Object.fromEntries(LAYERED.map((p) => [p, on.includes(p)]));

  /** Mise en place inconditionnelle au début d'une section (marqueur de section + parties actives). */
  const header = (b: ChunkBuilder, on: readonly Layered[], transpose: number | null = 0) => {
    b.marker(0, MARKER.SECTION_BASE + b.id);
    if (transpose !== null) b.hook(0, HOOK.SCORE, 0, { type: 'transpose', semitones: transpose });
    b.hook(0, HOOK.SCORE, 0, { type: 'parts', parts: { ...partsOn(on), ...Object.fromEntries(HOOKED_PARTS.map((p) => [p, false])) } });
  };

  /** Hooks LAYER aux frontières de phrase (toutes les 2 mesures). */
  const layers = (b: ChunkBuilder, table: Readonly<Record<(typeof LAYER_LEVELS)[number], readonly Layered[]>>) => {
    for (const level of LAYER_LEVELS) b.hookAtBars([0, 2, 4, 6], HOOK.LAYER, level, { type: 'parts', parts: partsOn(table[level]) });
  };

  const everyBar = (b: ChunkBuilder) => Array.from({ length: b.bars }, (_, i) => i);

  const tension = (b: ChunkBuilder) => {
    b.hookAtBars(everyBar(b), HOOK.TENSION, TENSION.ON, { type: 'parts', parts: { alarm: true } });
    b.hookAtBars(everyBar(b), HOOK.TENSION, TENSION.OFF, { type: 'parts', parts: { alarm: false } });
    b.line('alarm', m.alarm, { velocity: 90 });
  };

  /** Couches de vitesse : réévaluées à chaque mesure, écrites sur toute la section. */
  const speedLayers = (b: ChunkBuilder) => {
    for (const [tier, on] of Object.entries(SPEED_LAYERS)) {
      b.hookAtBars(everyBar(b), HOOK.SPEED, Number(tier), { type: 'parts', parts: Object.fromEntries(SPEED_PARTS.map((p) => [p, on.includes(p)])) });
    }
    b.drums('hat16', D.hatRush).drums('roll', D.roll).drums('kick2', D.kickSync);
    b.line('shaker', m.shaker, { velocity: 70 });
  };

  /**
   * Rugissement des dragons : entre (et sort) au premier temps d'une mesure, sur la progression du morceau.
   * Un impact marque chaque phrase de deux mesures.
   */
  const dragons = (b: ChunkBuilder) => {
    b.hookAtBars(everyBar(b), HOOK.DRAGON, DRAGON.ON, { type: 'parts', parts: { dragon: true, dragonhit: true } });
    b.hookAtBars(everyBar(b), HOOK.DRAGON, DRAGON.OFF, { type: 'parts', parts: { dragon: false, dragonhit: false } });
    for (let bar = 0; bar < b.bars; bar++) {
      const [, shift] = m.progression[bar % m.progression.length];
      b.line('dragon', m.dragon, { from: bar, to: bar + 1, shift, gate: 0.95, velocity: 110 });
      if (bar % 2 === 0) b.hit('dragonhit', bar, 0, 36, 112);
    }
  };

  const jumps = (b: ChunkBuilder, atBars: readonly number[], targets: Readonly<Partial<Record<number, number>>>) => {
    for (const [value, chunk] of Object.entries(targets)) b.hookAtBars(atBars, HOOK.JUMP, Number(value), { type: 'jump', chunk: chunk! });
  };

  const finish = (b: ChunkBuilder) => b.hookAtBars(barEnds(b.bars), HOOK.JUMP, JUMP.FINISH, { type: 'jump', chunk: MAIN.OUTRO });

  // ---------------------------------------------------------------- sections

  const intro = () => {
    const b = new ChunkBuilder(MAIN.INTRO, 'INTRO', 8);
    header(b, ['pad', 'sub', 'arp', 'hat', 'perc']);
    pads(b, 70);
    progressionLine(b, 'sub', m.subDrone, 0.95, 70);
    m.progression.forEach(([name], bar) => bar >= 2 && b.arp('arp', octaveUp(chord(name)), { from: bar, to: bar + 1, every: 2, velocity: 64 }));
    b.drums('hat', D.hats8, { from: 4 });
    b.line('perc', m.congas, { from: 6 });
    b.hit('riser', 7, 0, 60, 90, 16);
    jumps(b, barEnds(8), { [JUMP.GRID]: MAIN.GRID });
    return b;
  };

  /** Grille de départ : tension croissante, sortie au temps près sur le « GO ». */
  const grid = () => {
    const b = new ChunkBuilder(MAIN.GRID, 'GRID', 2);
    header(b, ['kick', 'hat', 'sub', 'pad', 'snare']);
    b.drums('kick', D.four);
    b.drums('hat', D.hats16);
    b.line('sub', `${R1} - `.repeat(8), { velocity: 90, gate: 0.6 });
    b.chord('pad', 0, 0, 32, chord(m.tonic), 72);
    b.drums('snare', 'x.x.x.x.x.x.xxxx', { from: 1 });
    b.hit('riser', 0, 0, 60, 100, 32);
    b.hookEveryBeat(HOOK.JUMP, JUMP.CRUISE, { type: 'jump', chunk: MAIN.CRUISE });
    finish(b);
    return b;
  };

  const cruise = () => {
    const b = new ChunkBuilder(MAIN.CRUISE, 'CRUISE', 8);
    header(b, ['break', 'snare', 'hat', 'sub', 'pad']);
    layers(b, {
      1: ['break', 'snare', 'hat', 'sub', 'pad'],
      2: ['break', 'snare', 'hat', 'sub', 'pad', 'acid'],
      3: ['break', 'snare', 'hat', 'ohat', 'perc', 'sub', 'pad', 'acid', 'stab'],
      4: ['break', 'snare', 'clap', 'hat', 'ohat', 'perc', 'sub', 'pad', 'acid', 'stab', 'arp'],
    });
    tension(b);
    speedLayers(b);
    dragons(b);
    b.drums('break', D.breakKick).drums('snare', D.breakSnare).drums('clap', D.clap).drums('hat', D.hats8).drums('ohat', D.openHats);
    b.line('perc', m.congas);
    progressionLine(b, 'acid', m.acidA, 0.55);
    progressionLine(b, 'sub', m.subCruise, 0.9, 100);
    pads(b);
    stabs(b);
    arps(b);
    jumps(b, [4, 8], { [JUMP.DRIVE]: MAIN.FILL_UP, [JUMP.FINAL]: MAIN.FILL_FINAL });
    jumps(b, [2, 4, 6, 8], { [JUMP.BREAKDOWN]: MAIN.BREAKDOWN });
    jumps(b, barEnds(8), { [JUMP.DROP]: MAIN.FILL_UP });
    finish(b);
    return b;
  };

  const fillUp = () => {
    const b = new ChunkBuilder(MAIN.FILL_UP, 'FILL_UP', 1).then(MAIN.DRIVE);
    header(b, ['kick', 'snare', 'sub', 'pad']);
    b.drums('kick', D.four);
    b.drums('snare', 'x.x.x.x.xxxxXXXX');
    b.line('sub', `${R1} _ _ _ _ _ _ _ ${R2} _ _ _ _ _ _ _`, { velocity: 100 });
    b.chord('pad', 0, 0, 16, chord(m.tonic), 80);
    b.hit('riser', 0, 0, 60, 110, 16);
    finish(b);
    return b;
  };

  const drive = () => {
    const b = new ChunkBuilder(MAIN.DRIVE, 'DRIVE', 8);
    header(b, ['kick', 'snare', 'hat', 'ohat', 'sub', 'acid']);
    layers(b, {
      1: ['kick', 'snare', 'hat', 'ohat', 'sub', 'acid'],
      2: ['kick', 'snare', 'clap', 'hat', 'ohat', 'sub', 'acid', 'stab'],
      3: ['kick', 'snare', 'clap', 'hat', 'ohat', 'sub', 'acid', 'stab', 'lead', 'pad'],
      4: ['kick', 'break', 'snare', 'clap', 'hat', 'ohat', 'perc', 'sub', 'acid', 'stab', 'lead', 'pad', 'arp'],
    });
    tension(b);
    speedLayers(b);
    dragons(b);
    b.hit('impact', 0, 0, 36, 90);
    b.drums('kick', D.four).drums('break', D.breakKick).drums('snare', D.breakSnare).drums('clap', D.clap);
    b.drums('hat', D.hats16).drums('ohat', D.openHats);
    b.line('perc', m.congas);
    progressionLine(b, 'acid', m.acidB, 0.5);
    progressionLine(b, 'sub', m.subDrive, 0.8, 104);
    pads(b, 64);
    stabs(b);
    arps(b, 1, 70);
    lead(b);
    jumps(b, [4, 8], { [JUMP.CRUISE]: MAIN.CRUISE, [JUMP.FINAL]: MAIN.FILL_FINAL });
    jumps(b, [2, 4, 6, 8], { [JUMP.BREAKDOWN]: MAIN.BREAKDOWN });
    jumps(b, barEnds(8), { [JUMP.DROP]: MAIN.FILL_UP });
    finish(b);
    return b;
  };

  /** Respiration : plus de batterie, la nappe et l'arpège portent la musique. */
  const breakdown = () => {
    const b = new ChunkBuilder(MAIN.BREAKDOWN, 'BREAKDOWN', 8);
    header(b, ['pad', 'arp', 'sub', 'hat', 'perc']);
    tension(b);
    dragons(b);
    pads(b, 88);
    arps(b, 1, 66);
    progressionLine(b, 'sub', m.subDrone, 0.95, 84);
    b.drums('hat', D.hats8, { from: 4 });
    b.line('perc', m.congas, { from: 6 });
    b.hit('riser', 6, 0, 60, 100, 32);
    jumps(b, [2, 4, 6, 8], { [JUMP.CRUISE]: MAIN.CRUISE, [JUMP.DRIVE]: MAIN.FILL_UP, [JUMP.FINAL]: MAIN.FILL_FINAL });
    jumps(b, barEnds(8), { [JUMP.DROP]: MAIN.FILL_UP });
    finish(b);
    return b;
  };

  /** Roulement avant le dernier tour ; la modulation est écrite à la toute fin. */
  const fillFinal = () => {
    const b = new ChunkBuilder(MAIN.FILL_FINAL, 'FILL_FINAL', 1).then(MAIN.FINAL);
    header(b, ['kick', 'snare', 'perc', 'sub', 'pad']);
    b.drums('snare', 'xxxxxxxxXXXXXXXX');
    b.drums('kick', 'x...x...x.x.x.xx');
    b.line('perc', m.fillPerc);
    b.line('sub', `${R1} ${'_ '.repeat(15)}`, { velocity: 100 });
    b.chord('pad', 0, 0, 16, chord(m.dominant), 84);
    b.hit('riser', 0, 0, 60, 120, 16);
    b.hook(b.length, HOOK.SCORE, 0, { type: 'transpose', semitones: m.modulation });
    finish(b);
    return b;
  };

  /** Dernier tour : tout l'orchestre, transposé (la modulation vient de FILL_FINAL). */
  const final = () => {
    const b = new ChunkBuilder(MAIN.FINAL, 'FINAL', 8);
    const all: Layered[] = ['kick', 'break', 'snare', 'clap', 'hat', 'ohat', 'perc', 'sub', 'acid', 'stab', 'lead', 'pad'];
    header(b, all, null);
    layers(b, { 1: all, 2: all, 3: [...all, 'arp'], 4: [...all, 'arp'] });
    tension(b);
    speedLayers(b);
    dragons(b);
    b.hit('impact', 0, 0, 36, 120);
    b.drums('kick', D.four).drums('break', D.breakKick).drums('snare', D.breakSnare).drums('clap', D.clap);
    b.drums('hat', D.hats16).drums('ohat', D.openHats);
    b.line('perc', m.congas);
    progressionLine(b, 'acid', m.acidB, 0.5);
    progressionLine(b, 'sub', m.subDrive, 0.8, 108);
    pads(b, 70);
    stabs(b);
    arps(b, 1, 72);
    lead(b);
    finish(b);
    return b;
  };

  const outro = () => {
    const b = new ChunkBuilder(MAIN.OUTRO, 'OUTRO', 2).then(null);
    header(b, ['pad', 'sub', 'lead'], null);
    b.hit('impact', 0, 0, 36, 127);
    b.chord('pad', 0, 0, 32, chord(m.tonic), 90);
    b.line('sub', `${R1} ${'_ '.repeat(15)}`, { from: 0, to: 1, velocity: 96 });
    b.line('lead', `${R5} ${'_ '.repeat(15)}`, { from: 0, to: 1, velocity: 100 });
    b.marker(b.length, MARKER.OUTRO_END);
    return b;
  };

  return {
    id: m.id,
    name: m.name,
    bpm: m.bpm,
    priority: 50,
    volume: m.volume,
    parts: allParts(m.parts),
    startChunk: MAIN.INTRO,
    chunks: [intro(), grid(), cruise(), fillUp(), drive(), breakdown(), fillFinal(), final(), outro()].map((b) => b.build()),
  };
}
