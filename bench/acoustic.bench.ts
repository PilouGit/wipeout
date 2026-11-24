/** Banc de l'occlusion acoustique : `npx vite-node bench/acoustic.bench.ts`. */
import { Vector3 } from 'three';
import { AcousticWorld } from '../src/audio/spatial/AcousticWorld';
import { TRACK_HALF_WIDTH } from '../src/config';
import { CIRCUITS } from '../src/track/circuits';
import { Track } from '../src/track/Track';

for (const c of CIRCUITS) {
  const track = new Track(c.layout, TRACK_HALF_WIDTH);
  const world = new AcousticWorld(track);
  // paires auditeur / source : un vaisseau et un concurrent 20 à 120 m plus loin, décalés
  const pairs: [Vector3, Vector3][] = [];
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 2000; k++) {
    const s = rnd() * track.length;
    const a = track.points[Math.floor(s / track.spacing) % track.count].clone().add(new Vector3(0, 1, 0));
    const b = track.points[Math.floor((s + 20 + rnd() * 100) / track.spacing) % track.count].clone().add(new Vector3(rnd() * 8 - 4, 1, 0));
    pairs.push([a, b]);
  }
  let sum = 0;
  for (const [a, b] of pairs) sum += world.occlusion(a, b); // chauffe
  const t0 = performance.now();
  for (let r = 0; r < 5; r++) for (const [a, b] of pairs) sum += world.occlusion(a, b);
  const us = ((performance.now() - t0) / (5 * pairs.length)) * 1000;
  console.log(`${c.name.padEnd(15)} occlusion : ${us.toFixed(2)} µs/appel (contrôle ${sum.toFixed(3)})`);
}
