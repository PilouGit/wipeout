/**
 * Jingles de fin de course, lancés par un trigger posé sur le marqueur OUTRO_END du thème :
 * une phrase d'arrivée (HIT) puis une boucle calme pour l'écran de résultats (LOOP).
 */
import type { PartDef, SoundFile } from '../imuse/types';
import { MARKER, SOUND, STINGER } from './ids';
import { ChunkBuilder } from './notation';

const PARTS: readonly PartDef[] = [
  { name: 'kick', instrument: 'kick', volume: 100, drum: true },
  { name: 'hat', instrument: 'hat', volume: 70, drum: true, pan: 0.25 },
  { name: 'ohat', instrument: 'openhat', volume: 60, drum: true, pan: -0.2 },
  { name: 'impact', instrument: 'impact', volume: 100, drum: true, reverb: 0.5 },
  { name: 'sub', instrument: 'reese', volume: 90 },
  { name: 'stab', instrument: 'stab', volume: 96, reverb: 0.3, delay: 0.3 },
  { name: 'pad', instrument: 'pad', volume: 96, reverb: 0.6 },
  { name: 'arp', instrument: 'pluck', volume: 70, pan: 0.3, delay: 0.4, reverb: 0.3 },
  { name: 'lead', instrument: 'lead', volume: 90, delay: 0.3, reverb: 0.35 },
];

function victory(): SoundFile {
  // Fa mineur → Ré♭ → Mi♭ → Fa MAJEUR (tierce picarde) : la course finit dans la lumière
  const hit = new ChunkBuilder(STINGER.HIT, 'FANFARE', 2).then(STINGER.LOOP);
  hit.marker(0, MARKER.SECTION_BASE + STINGER.HIT);
  hit.hit('impact', 0, 0, 36, 127);
  for (const [step, chord] of [[0, ['Db3', 'F3', 'Ab3', 'C4']], [4, ['Db3', 'F3', 'Ab3', 'C4']], [8, ['Eb3', 'G3', 'Bb3', 'Eb4']], [12, ['Eb3', 'G3', 'Bb3', 'Eb4']]] as const) {
    hit.chord('stab', 0, step, 2, chord, 112);
  }
  hit.chord('pad', 1, 0, 16, ['F3', 'A3', 'C4', 'F4'], 100);
  hit.chord('stab', 1, 0, 2, ['F3', 'A3', 'C4', 'F4'], 127);
  hit.line('lead', 'C5 _ Eb5 _ F5 _ Ab5 _ G5 _ _ _ Bb5 _ _ _ C6 _ _ _ _ _ _ _ _ _ _ _ _ _ _ _', { velocity: 110, gate: 0.95 });
  hit.line('sub', 'Db1 _ _ _ _ _ _ _ Eb1 _ _ _ _ _ _ _ F1 _ _ _ _ _ _ _ _ _ _ _ _ _ _ _', { velocity: 100 });

  const loop = new ChunkBuilder(STINGER.LOOP, 'AFTERGLOW', 8);
  loop.marker(0, MARKER.SECTION_BASE + STINGER.LOOP);
  const prog = [['F3', 'A3', 'C4', 'E4'], ['Db3', 'F3', 'Ab3', 'C4'], ['Eb3', 'G3', 'Bb3', 'D4'], ['F3', 'A3', 'C4', 'E4']] as const;
  prog.forEach((c, i) => {
    loop.chord('pad', i * 2, 0, 32, c, 80);
    loop.arp('arp', c.map((n) => n.replace(/(\d)$/, (d) => String(Number(d) + 1))), { from: i * 2, to: i * 2 + 2, every: 2, velocity: 62 });
  });
  loop.line('sub', 'F1 _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ F1 _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ Db1 _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ Db1 _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ Eb1 _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ Eb1 _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ F1 _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ F1 _ _ _ _ _ _ _ _ _ _ _ _ _ _ _', { velocity: 76 });
  loop.drums('kick', 'x.......x.......');
  loop.drums('hat', '..x...x...x...xo');

  return { id: SOUND.VICTORY, name: 'Victory', bpm: 138, priority: 60, volume: 110, parts: PARTS, startChunk: STINGER.HIT, chunks: [hit.build(), loop.build()] };
}

function defeat(): SoundFile {
  const hit = new ChunkBuilder(STINGER.HIT, 'FALL', 2).then(STINGER.LOOP);
  hit.marker(0, MARKER.SECTION_BASE + STINGER.HIT);
  hit.hit('impact', 0, 0, 36, 110);
  hit.chord('pad', 0, 0, 16, ['F3', 'Ab3', 'C4', 'Eb4'], 92);
  hit.chord('pad', 1, 0, 16, ['Db3', 'F3', 'Ab3', 'C4'], 88);
  hit.line('lead', 'Ab4 _ _ G4 _ _ F4 _ _ _ Eb4 _ _ C4 _ _ Db4 _ _ _ _ _ _ _ C4 _ _ _ _ _ _ _', { velocity: 96, gate: 0.95 });
  hit.line('sub', 'F1 _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ Db1 _ _ _ _ _ _ _ _ _ _ _ _ _ _ _', { velocity: 96 });

  const loop = new ChunkBuilder(STINGER.LOOP, 'AFTERMATH', 8);
  loop.marker(0, MARKER.SECTION_BASE + STINGER.LOOP);
  const prog = [['F3', 'Ab3', 'C4', 'Eb4'], ['Db3', 'F3', 'Ab3', 'C4'], ['Bb2', 'Db3', 'F3', 'Ab3'], ['C3', 'E3', 'G3', 'Bb3']] as const;
  prog.forEach((c, i) => loop.chord('pad', i * 2, 0, 32, c, 74));
  loop.line('arp', 'C5 - - - - - Ab4 - - - - - F4 - - - - - - - Eb4 - - - - - - - - - - -', { velocity: 58 });
  loop.line('sub', 'F1 _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ Db1 _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ Bb0 _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ C1 _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _', { velocity: 70 });

  return { id: SOUND.DEFEAT, name: 'Defeat', bpm: 100, priority: 60, volume: 104, parts: PARTS, startChunk: STINGER.HIT, chunks: [hit.build(), loop.build()] };
}

export const VICTORY = victory();
export const DEFEAT = defeat();
