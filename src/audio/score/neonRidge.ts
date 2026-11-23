/**
 * « Neon Ridge » — thème principal original, écrit à la main, 150 BPM, Fa mineur.
 * Techno breakbeat dans l'esprit des bandes-son de course anti-gravité des années 90 :
 * breaks syncopés, basse acide, stabs d'accords, nappes et arpèges.
 * L'architecture des sections et des hooks est décrite dans compose.ts.
 */
import type { PartDef } from '../imuse/types';
import { composeTheme, type ThemeMaterial } from './compose';
import { SOUND } from './ids';

/** Parties communes aux thèmes de course (les thèmes générés en changent les timbres). */
export const BASE_PARTS: readonly PartDef[] = [
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

export const NEON_RIDGE_MATERIAL: ThemeMaterial = {
  id: SOUND.MAIN,
  name: 'Neon Ridge',
  bpm: 150,
  volume: 112,
  parts: BASE_PARTS,
  chords: {
    Fm: ['F3', 'Ab3', 'C4', 'Eb4'],
    Db: ['Db3', 'F3', 'Ab3', 'C4'],
    Eb: ['Eb3', 'G3', 'Bb3', 'D4'],
    Bbm: ['Bb2', 'Db3', 'F3', 'Ab3'],
    C: ['C3', 'E3', 'G3', 'Bb3'],
  },
  progression: [['Fm', 0], ['Fm', 0], ['Db', -4], ['Db', -4], ['Eb', -2], ['Eb', -2], ['Bbm', 5], ['C', 7]],
  tonic: 'Fm',
  dominant: 'C',
  root: { low: 'F1', mid: 'F2', high: 'F5' },
  modulation: 2,
  drums: {
    four: 'x...x...x...x...',
    breakKick: 'x.....x...x..... x.x.......x..x..',
    breakSnare: '....X..o.o..X..o ....X..o....X.oo',
    clap: '....x.......x...',
    hats8: 'x.x.x.x.x.x.x.xo',
    hats16: 'xoxoxoxoxoxoxoXo',
    openHats: '..x...x...x...x.',
    hatRush: 'oxoxoxoxoxoxoxoX',
    roll: '................ ............oxXX',
    kickSync: '..x.......x..x.. ..x....x..x...x.',
  },
  congas: 'C4 - G3 C4 - - G3 - C4 - G3 - - C4 G3 G3',
  shaker: 'C6 G5 C6 C6 G5 C6 G5 C6 C6 G5 C6 G5 C6 C6 G5 G5',
  acidA: 'F2! F2 F3 - Eb3~ F3 - C3 F2 - Ab2! Bb2 F3~ - C3 Eb3',
  acidB: 'F2! F3 F2 Eb3 F2 C3! F2 Ab3~ F2 F3 F2! Eb3 F2 Bb2 C3~ F3',
  subCruise: 'F1 _ _ _ _ _ - F1 _ _ - F2 _ - C2 _',
  subDrive: 'F1 - F1 F2 - F1 F1 - F1 - F1 F2 - F1 Eb2 -',
  subDrone: 'F1 _ _ _ _ _ _ _ _ _ _ _ _ _ _ _',
  alarm: 'C6 - F6 - C6 - F6 - C6 - F6 - C6 - F6 -',
  lead: [
    'C5 _ _ Ab4 _ _ F4 _ G4 _ Ab4 _ C5 _ Eb5 _',
    'Db5 _ _ C5 _ _ Ab4 _ _ _ F4 _ G4 _ _ _',
    'Eb5 _ _ Db5 _ _ C5 _ Bb4 _ C5 _ Db5 _ Eb5 _',
    'F5 _ _ _ _ _ Eb5 _ C5 _ _ _ _ _ - -',
    'Eb5 _ _ Bb4 _ _ G4 _ Bb4 _ Eb5 _ G5 _ F5 _',
    'Eb5 _ _ _ Db5 _ C5 _ Bb4 _ _ _ G4 _ _ _',
    'F5 _ _ Db5 _ _ Bb4 _ Db5 _ F5 _ Ab5 _ G5 _',
    'E5 _ _ _ G5 _ _ _ C5 _ _ _ _ _ - -',
  ],
  stabSteps: [2, 6, 9, 12],
  fillPerc: 'C5 - A4 - F4 - C4 - A3 - F3 - C3 - C3 -',
  dragon: 'F2! _ _ _ Gb2~ _ F2 _ - - C3! _ Db3~ _ C3 _',
};

export const NEON_RIDGE = composeTheme(NEON_RIDGE_MATERIAL);
