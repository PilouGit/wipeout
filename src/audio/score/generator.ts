/**
 * Générateur de thèmes de course à partir d'une graine : tonalité, mode, tempo, progression,
 * motifs de batterie, lignes de basse acide, mélodie, rugissement des dragons et timbres.
 * Même graine → même morceau ; le style fixe la couleur (tempo, modes, instruments, densité).
 * La structure en sections et le contrat de hooks sont ceux de compose.ts.
 */
import type { PartDef, SoundFile } from '../imuse/types';
import { composeTheme, type ThemeMaterial } from './compose';
import { BASE_PARTS } from './neonRidge';

export type ThemeStyle = 'breakbeat' | 'trance' | 'industrial' | 'space';

export interface ThemeRecipe {
  readonly id: number;
  readonly name: string;
  readonly seed: number;
  readonly style: ThemeStyle;
}

// ------------------------------------------------------------------ hasard reproductible

export type Rng = () => number;

/** mulberry32 : petit générateur 32 bits, suffisant et identique sur toutes les plateformes. */
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const between = (r: Rng, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

// ------------------------------------------------------------------ hauteurs

const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
/** 41 → « F2 ». */
export const noteName = (midi: number): string => `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;

const SCALES = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  harmonic: [0, 2, 3, 5, 7, 8, 11],
} as const;
type ScaleName = keyof typeof SCALES;

/** Progressions de 8 mesures en degrés (0 = tonique) ; la dernière mesure est toujours la dominante. */
const PROGRESSIONS: readonly (readonly number[])[] = [
  [0, 0, 5, 5, 6, 6, 3, 4],
  [0, 6, 5, 6, 0, 6, 5, 4],
  [0, 0, 3, 3, 5, 5, 4, 4],
  [0, 5, 2, 6, 0, 5, 3, 4],
  [0, 3, 0, 5, 0, 3, 6, 4],
  [0, 2, 5, 6, 0, 2, 3, 4],
  [0, 0, 6, 6, 5, 5, 6, 4],
];

// ------------------------------------------------------------------ styles

interface Style {
  readonly bpm: readonly [number, number];
  readonly scales: readonly ScaleName[];
  readonly volume: number;
  /** Densité des lignes acides (croisière, poursuite). */
  readonly acid: readonly [number, number];
  /** Remplacements de timbre / niveau des parties. */
  readonly parts: Readonly<Record<string, Partial<PartDef>>>;
  readonly four: readonly string[];
}

const STYLES: Readonly<Record<ThemeStyle, Style>> = {
  breakbeat: {
    bpm: [146, 154], scales: ['minor', 'dorian'], volume: 112, acid: [0.62, 0.85],
    parts: {},
    four: ['x...x...x...x...', 'x...x...x...x.x.'],
  },
  trance: {
    bpm: [138, 146], scales: ['minor', 'dorian', 'harmonic'], volume: 110, acid: [0.55, 0.8],
    parts: {
      acid: { instrument: 'pluck', volume: 92, delay: 0.3 },
      arp: { volume: 90, delay: 0.4 },
      pad: { volume: 100, reverb: 0.65 },
      stab: { instrument: 'pluck', volume: 84 },
    },
    four: ['x...x...x...x...'],
  },
  industrial: {
    bpm: [156, 166], scales: ['phrygian', 'harmonic', 'minor'], volume: 114, acid: [0.75, 0.95],
    parts: {
      acid: { volume: 108, delay: 0.08 },
      sub: { volume: 112 },
      pad: { volume: 78 },
      snare: { volume: 108, reverb: 0.2 },
      lead: { instrument: 'stab', volume: 92 },
    },
    four: ['x...x...x...x...', 'x..xx...x..xx...', 'x...x..xx...x...'],
  },
  space: {
    bpm: [132, 142], scales: ['dorian', 'harmonic'], volume: 110, acid: [0.45, 0.7],
    parts: {
      pad: { volume: 104, reverb: 0.75 },
      arp: { volume: 90, delay: 0.45, reverb: 0.35 },
      lead: { volume: 82, delay: 0.4, reverb: 0.5 },
      acid: { instrument: 'reese', volume: 92 },
      perc: { volume: 88, reverb: 0.35 },
    },
    four: ['x...x...x...x...', 'x.....x...x.....'],
  },
};

// ------------------------------------------------------------------ batterie

const DRUMS = {
  breakKick: ['x.....x...x..... x.x.......x..x..', 'x.....x.x.....x. x..x......x.x...', 'x.x.......x..... x.....x...x..x..', 'x......xx.....x. x.x......x..x...'],
  breakSnare: ['....X..o.o..X..o ....X..o....X.oo', '....X.....o.X... ....X..o.o..X.o.', '....X..o....X..o ..o.X.......Xoxo'],
  clap: ['....x.......x...', '....x.......x..x', '.......x....x...'],
  hats8: ['x.x.x.x.x.x.x.xo', '.x.x.x.x.x.x.x.x', 'x.xox.x.x.xox.x.'],
  hats16: ['xoxoxoxoxoxoxoXo', 'xxoxxxoxxxoxxxox', 'xoxxxoxxxoxxxoXx'],
  openHats: ['..x...x...x...x.', '..x...x...x..xx.', '......x.......x.'],
  hatRush: ['oxoxoxoxoxoxoxoX', 'xxxoxxxoxxxoxxXX'],
  roll: ['................ ............oxXX', '................ ........o.x.xXXX'],
  kickSync: ['..x.......x..x.. ..x....x..x...x.', '.x....x...x..x.. ...x..x.x.....x.'],
  congas: ['C4 - G3 C4 - - G3 - C4 - G3 - - C4 G3 G3', 'D4 - - A3 - D4 - A3 - - D4 - A3 A3 - D4', 'G3 - C4 - - G3 C4 - G3 - - C4 - G3 C4 C4'],
  shaker: ['C6 G5 C6 C6 G5 C6 G5 C6 C6 G5 C6 G5 C6 C6 G5 G5', 'C6 C6 G5 C6 C6 C6 G5 C6 C6 C6 G5 C6 C6 G5 C6 G5'],
};

/** Saupoudre des notes fantômes sur les silences d'un motif de batterie. */
function ghosts(r: Rng, pattern: string, p: number): string {
  return pattern.replace(/\./g, () => (r() < p ? 'o' : '.'));
}

// ------------------------------------------------------------------ mélodies

/** Rythmes de mesure de la mélodie : [départ, durée] en doubles croches. */
const LEAD_RHYTHMS: readonly (readonly (readonly [number, number])[])[] = [
  [[0, 3], [3, 3], [6, 2], [8, 2], [10, 2], [12, 2], [14, 2]],
  [[0, 3], [3, 3], [6, 4], [10, 2], [12, 4]],
  [[0, 6], [6, 2], [8, 6], [14, 2]],
  [[0, 2], [2, 2], [4, 2], [6, 2], [8, 4], [12, 4]],
  [[0, 4], [4, 2], [6, 2], [8, 3], [11, 3], [14, 2]],
];

/** Écrit une mesure de 16 doubles croches à partir de (départ, durée, note). */
function bar(events: readonly (readonly [number, number, number])[]): string {
  const out = new Array<string>(16).fill('-');
  for (const [at, len, note] of events) {
    out[at] = noteName(note);
    for (let k = 1; k < len && at + k < 16; k++) out[at + k] = '_';
  }
  return out.join(' ');
}

/** Toutes les notes de la gamme entre lo et hi. */
function scaleNotes(pc: number, scale: readonly number[], lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let n = lo; n <= hi; n++) if (scale.includes((((n - pc) % 12) + 12) % 12)) out.push(n);
  return out;
}

/** Note la plus proche de `from` dans `pool`, à au plus `reach` demi-tons, tirée au hasard avec une tendance. */
function step(r: Rng, from: number, pool: readonly number[], trend: number, reach = 5): number {
  const near = pool.filter((n) => n !== from && Math.abs(n - from) <= reach);
  if (!near.length) return pool.reduce((a, b) => (Math.abs(b - from) < Math.abs(a - from) ? b : a));
  const weights = near.map((n) => 1 / (1 + Math.abs(n - from)) * (Math.sign(n - from) === trend ? 1.8 : 1));
  let x = r() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < near.length; i++) if ((x -= weights[i]) <= 0) return near[i];
  return near[near.length - 1];
}

/** Un motif : rythme d'une mesure et contour en pas de gamme (le premier pas part de la note d'accord). */
interface Motif {
  readonly rhythm: readonly (readonly [number, number])[];
  readonly steps: readonly number[];
}

function motif(r: Rng, rhythm: readonly (readonly [number, number])[]): Motif {
  // contour : surtout des pas conjoints, un saut de temps en temps, une direction dominante
  const dir = r() < 0.5 ? 1 : -1;
  const steps = rhythm.map((_, k) => {
    if (k === 0) return 0;
    const u = r();
    const size = u < 0.55 ? 1 : u < 0.85 ? 2 : u < 0.95 ? 0 : 3;
    return size * (r() < 0.72 ? dir : -dir);
  });
  return { rhythm, steps };
}

/** Variation : même rythme, la fin du contour change (réponse à la phrase). */
const vary = (r: Rng, m: Motif): Motif => ({
  rhythm: m.rhythm,
  steps: m.steps.map((s, k) => (k >= m.steps.length - 2 ? s + (r() < 0.5 ? 1 : -1) * (1 + Math.floor(r() * 2)) : s)),
});

/** Renversement : le contour est inversé (contraste). */
const invert = (m: Motif): Motif => ({ rhythm: m.rhythm, steps: m.steps.map((s) => -s) });

/**
 * Mélodie de 8 mesures, construite comme un compositeur : un motif d'une mesure, répété,
 * varié puis contrasté, posé sur l'accord de chaque mesure, avec cadences en fin de demi-phrase.
 * Forme : A A' B cadence | A A'' C cadence finale. Les temps forts tombent sur des notes de l'accord.
 */
function melody(r: Rng, degrees: readonly number[], chordTones: Readonly<Record<number, number[]>>, pool: readonly number[]): string[] {
  const a = motif(r, pick(r, LEAD_RHYTHMS));
  const b = r() < 0.5 ? invert(a) : motif(r, pick(r, LEAD_RHYTHMS));
  const c = motif(r, pick(r, LEAD_RHYTHMS));
  const form: (Motif | 'cadence' | 'final')[] = [a, vary(r, a), b, 'cadence', a, vary(r, a), c, 'final'];
  const tonesOf = (d: number) => chordTones[d].flatMap((n) => [n + 12, n + 24]).filter((n) => n >= pool[0] && n <= pool[pool.length - 1]);
  const nearest = (xs: readonly number[], to: number) => xs.reduce((p, q) => (Math.abs(q - to) < Math.abs(p - to) ? q : p));
  // la sensible de la dominante n'est pas dans la gamme : on se repère sur la note de gamme la plus proche
  const indexNear = (note: number) => pool.indexOf(nearest(pool, note));
  let last = nearest(pool, 72);

  return degrees.map((d, bar_) => {
    const tones = tonesOf(d);
    const item = form[bar_];
    if (item === 'cadence' || item === 'final') {
      // cadence : deux notes d'accord vers la fondamentale (demi-cadence) ou la sensible (dominante finale)
      const root = nearest(tones.filter((n) => (n - chordTones[d][0]) % 12 === 0), last);
      const goal = item === 'final' && d === 4 ? nearest(tones.filter((n) => (n - chordTones[d][1]) % 12 === 0), root) : root;
      const mid = nearest(tones.filter((n) => n !== goal), (last + goal) / 2);
      last = goal;
      return bar([[0, 6, mid], [6, 2, nearest(pool, (mid + goal) / 2)], [8, 6, goal]]);
    }
    // le motif part de la note d'accord la plus proche de la fin de la mesure précédente
    let idx = indexNear(nearest(tones, last));
    return bar(item.rhythm.map(([at, len], k) => {
      idx += item.steps[k];
      // rebond aux bornes du registre
      if (idx < 0) idx = -idx;
      if (idx >= pool.length) idx = 2 * (pool.length - 1) - idx;
      let note = pool[idx];
      // temps fort : note de l'accord
      if (at % 4 === 0) {
        note = nearest(tones, note);
        idx = indexNear(note);
      }
      last = note;
      return [at, len, note] as const;
    }));
  });
}

// ------------------------------------------------------------------ génération

export function generateMaterial(recipe: ThemeRecipe): ThemeMaterial {
  const r = rng(recipe.seed);
  const style = STYLES[recipe.style];
  const scale = [...SCALES[pick(r, style.scales)]];
  const pc = between(r, 0, 11);
  const bpm = between(r, style.bpm[0], style.bpm[1]);
  const degrees = pick(r, PROGRESSIONS);

  // accords à 4 sons empilés dans la gamme ; dominante toujours majeure (sensible)
  const chordOf = (d: number): number[] => {
    const iv = d === 4 ? [7, 11, 14, 17] : [0, 2, 4, 6].map((k) => scale[(d + k) % 7] + 12 * Math.floor((d + k) / 7));
    let base = 48 + pc;
    if (base + iv[0] > 55) base -= 12;
    return iv.map((i) => base + i);
  };
  const chords: Record<string, string[]> = {};
  const chordTones: Record<number, number[]> = {};
  for (const d of new Set([...degrees, 0, 4])) {
    chordTones[d] = chordOf(d);
    chords[`d${d}`] = chordTones[d].map(noteName);
  }
  const shiftOf = (d: number) => {
    const s = d === 4 ? 7 : scale[d];
    return s > 7 ? s - 12 : s;
  };
  const progression = degrees.map((d) => [`d${d}`, shiftOf(d)] as const);

  // basse : tonique grave (octave 1), lignes écrites sur la tonique puis transposées par la progression
  const low = 24 + pc;
  const R = noteName(low);
  const O = noteName(low + 12);
  const F = noteName(low + 7);
  const sub = (tpl: string) => tpl.replace(/\bR\b/g, R).replace(/\bO\b/g, O).replace(/\bF\b/g, F);
  const subCruise = sub(pick(r, ['R _ _ _ _ _ - R _ _ - O _ - F _', 'R _ - R _ - R _ - R _ - O _ R _', 'R _ _ _ - - R _ _ _ R _ O _ F _']));
  const subDrive = sub(pick(r, ['R - R O - R R - R - R O - R F -', 'R _ R _ - R O R - R _ R - O R -', 'R - - R - - R - R - - R - O - R']));

  // acide : marche aléatoire sur la gamme autour de la tonique (octaves 2-3)
  const acidPool = scaleNotes(pc, scale, 36 + pc - 2, 36 + pc + 15);
  const acidLine = (density: number) => {
    const out: string[] = [];
    let cur = 36 + pc;
    for (let i = 0; i < 16; i++) {
      if (i === 0) {
        out.push(`${noteName(cur)}!`);
        continue;
      }
      if (r() > density) {
        out.push('-');
        continue;
      }
      const u = r();
      cur = u < 0.3 ? 36 + pc : u < 0.5 ? 48 + pc : step(r, cur, acidPool, r() < 0.5 ? 1 : -1, 7);
      out.push(noteName(cur) + (r() < 0.18 ? '!' : r() < 0.15 ? '~' : ''));
    }
    return out.join(' ');
  };

  const lead = melody(r, degrees, chordTones, scaleNotes(pc, scale, 60, 86));

  // rugissement des dragons (une mesure) : tonique, seconde mineure, quinte, sixte mineure (octave 2)
  const roar = (deg: number) => noteName(36 + pc + deg);
  const dragon = pick(r, [
    `R! _ _ _ b2~ _ R _ - - 5! _ b6~ _ 5 _`,
    `R! _ _ _ _ _ b2~ _ _ _ R _ - - b3! _`,
    `5! _ b6~ _ 5 _ - - R! _ _ b2~ _ _ R _`,
    `R! _ 8~ _ _ _ b6~ _ 5 _ _ _ b2~ _ R _`,
  ]).replace(/\b(R|b2|b3|5|b6|8)\b/g, (t) => roar({ R: 0, b2: 1, b3: 3, '5': 7, b6: 8, '8': 12 }[t]!));

  // percussions du roulement final : arpège descendant de la dominante
  const dom = [7, 11, 14].map((i) => 60 + pc + i);
  const fillPerc = Array.from({ length: 8 }, (_, k) => noteName(dom[2 - (k % 3)] - 12 * Math.floor(k / 3)) + ' -').join(' ');

  const parts = BASE_PARTS.map((p) => ({ ...p, ...style.parts[p.name] }) as PartDef);

  return {
    id: recipe.id,
    name: recipe.name,
    bpm,
    volume: style.volume,
    parts,
    chords,
    progression,
    tonic: 'd0',
    dominant: 'd4',
    root: { low: R, mid: O, high: noteName(72 + pc) },
    modulation: pick(r, [1, 2, 2, 3]),
    drums: {
      four: pick(r, style.four),
      breakKick: pick(r, DRUMS.breakKick),
      breakSnare: ghosts(r, pick(r, DRUMS.breakSnare), 0.05),
      clap: pick(r, DRUMS.clap),
      hats8: pick(r, DRUMS.hats8),
      hats16: pick(r, DRUMS.hats16),
      openHats: pick(r, DRUMS.openHats),
      hatRush: pick(r, DRUMS.hatRush),
      roll: pick(r, DRUMS.roll),
      kickSync: pick(r, DRUMS.kickSync),
    },
    congas: pick(r, DRUMS.congas),
    shaker: pick(r, DRUMS.shaker),
    acidA: acidLine(style.acid[0]),
    acidB: acidLine(style.acid[1]),
    subCruise,
    subDrive,
    subDrone: `${R} ${'_ '.repeat(15)}`.trim(),
    alarm: Array.from({ length: 8 }, (_, k) => `${noteName(k % 2 ? 84 + pc : 79 + pc)} -`).join(' '),
    lead,
    stabSteps: pick(r, [[2, 6, 9, 12], [0, 3, 6, 10], [2, 5, 10, 13], [3, 6, 11, 14]]),
    fillPerc,
    dragon,
  };
}

export function generateTheme(recipe: ThemeRecipe): SoundFile {
  return composeTheme(generateMaterial(recipe));
}
