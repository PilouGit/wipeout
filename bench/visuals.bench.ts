/**
 * Banc de mesure des mises à jour visuelles par image (hors GPU) : `npx vite-node bench/visuals.bench.ts`.
 * Musique réelle (Neon Ridge en DRIVE), décor du circuit, 60 images/s.
 */
import { Object3D } from 'three';
import { IMuse } from '../src/audio/imuse/IMuse';
import { MusicPulse } from '../src/audio/imuse/MusicPulse';
import type { MusicOutput } from '../src/audio/imuse/types';
import { HOOK, MAIN, SOUND } from '../src/audio/score';
import { NEON_RIDGE } from '../src/audio/score/neonRidge';
import { MusicBands } from '../src/render/music/MusicBands';
import { ReactiveGround } from '../src/render/music/ReactiveGround';
import { Staging } from '../src/render/music/Staging';
import { TRACK_HALF_WIDTH } from '../src/config';
import { CIRCUITS } from '../src/track/circuits';
import { Track } from '../src/track/Track';

class NullOutput implements MusicOutput {
  t = 0;
  now() { return this.t; }
  createSound() {}
  destroySound() {}
  note() {}
  setPartGain() {}
  setSoundGain() {}
  controller() {}
  allNotesOff() {}
}

const DT = 1 / 60;
const out = new NullOutput();
const pulse = new MusicPulse(out);
const imuse = new IMuse(pulse, [NEON_RIDGE]);
imuse.startSound(SOUND.MAIN, MAIN.DRIVE);
imuse.setHook(SOUND.MAIN, HOOK.LAYER, 4);
const stage = new Staging();
const bands = new MusicBands();
const camera = new Object3D();
const track = new Track(CIRCUITS[0].layout, TRACK_HALF_WIDTH);

for (const lite of [false, true]) {
  const ground = new ReactiveGround(track, [0xff2bd6, 0x2ef2ff], lite);
  const frames = 1800;
  let groundMs = 0;
  for (let i = 0; i < frames; i++) {
    out.t += DT;
    imuse.update();
    const f = pulse.sample(imuse.clock(SOUND.MAIN));
    bands.update(f, DT);
    stage.update(DT, f, camera);
    const t0 = performance.now();
    ground.update(DT, bands, stage);
    if (i >= 300) groundMs += performance.now() - t0;
  }
  const h = ground.mesh.geometry.getAttribute('aHeight').array as Float32Array;
  let sum = 0;
  for (const v of h) sum += v;
  console.log(`sol ${lite ? 'allégé' : 'complet'} : ${ground.mesh.count} colonnes, ${(groundMs / (frames - 300)).toFixed(3)} ms/image (contrôle ${sum.toFixed(1)})`);
}
