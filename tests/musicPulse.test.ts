import { describe, expect, it } from 'vitest';
import { IMuse } from '../src/audio/imuse/IMuse';
import { MusicPulse } from '../src/audio/imuse/MusicPulse';
import type { MusicOutput, PartDef, SoundFile } from '../src/audio/imuse/types';
import { ChunkBuilder } from '../src/audio/score/notation';
import { MusicBands } from '../src/render/music/MusicBands';

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

const PARTS: PartDef[] = [
  { name: 'kick', instrument: 'kick', volume: 120, drum: true },
  { name: 'hat', instrument: 'hat', volume: 90, drum: true },
];

/** 120 BPM : un temps = 0,5 s. Kick sur chaque temps, charleston en contretemps. */
function song(kick = 'x...x...x...x...'): SoundFile {
  const a = new ChunkBuilder(0, 'A', 1);
  a.drums('kick', kick, { note: 36 });
  a.drums('hat', '..x...x...x...x.', { note: 42 });
  return { id: 1, name: 'beat', bpm: 120, priority: 10, volume: 127, parts: PARTS, startChunk: 0, chunks: [a.build()] };
}

function setup(kick?: string) {
  const out = new NullOutput();
  const pulse = new MusicPulse(out);
  const imuse = new IMuse(pulse, [song(kick)]);
  imuse.startSound(1);
  const runTo = (t: number) => {
    while (out.t < t - 1e-9) {
      out.t = Math.min(t, out.t + 0.025);
      imuse.update();
    }
    return pulse.sample(imuse.clock(1));
  };
  return { out, imuse, pulse, runTo };
}

describe('MusicPulse (écoute de la sortie iMUSE)', () => {
  it("ne déclenche l'enveloppe qu'à l'heure audio de la note, pas à sa planification", () => {
    const { runTo } = setup();
    // à 0,45 s, le kick de 0,5 s est déjà planifié (lookahead) mais pas encore joué
    const before = runTo(0.45);
    const at = runTo(0.51);
    expect(at.env.kick).toBeGreaterThan(0.6); // vélocité 96/127
    expect(at.env.kick).toBeGreaterThan(before.env.kick);
    expect(at.waveAge[0]).toBeCloseTo(0.01, 2);
  });

  it('les enveloppes décroissent entre les attaques', () => {
    const { runTo } = setup();
    const hit = runTo(1.01).env.kick;
    const later = runTo(1.4).env.kick;
    expect(later).toBeLessThan(hit * 0.2);
  });

  it("l'horloge suit le temps dans la mesure", () => {
    const { runTo, imuse } = setup();
    runTo(1.25);
    const c = imuse.clock(1)!;
    expect(c.beat).toBeCloseTo(2.5, 1);
    expect(c.beatsPerSecond).toBeCloseTo(2, 5);
  });

  it('la pause coupe les nouvelles attaques', () => {
    const { runTo, imuse } = setup();
    runTo(0.3);
    imuse.pause();
    const f = runTo(2.6);
    expect(f.env.kick).toBeLessThan(0.01);
  });

  it('MusicBands détecte un drop puis une accalmie', () => {
    const { runTo, imuse } = setup('x.x.x.x.x.x.x.x.');
    const bands = new MusicBands();
    let drops = 0;
    for (let t = 0.02; t < 4; t += 0.02) {
      bands.update(runTo(t), 0.02);
      if (bands.drop) drops++;
    }
    expect(drops).toBeGreaterThan(0);
    imuse.stopSound(1);
    for (let t = 4; t < 8; t += 0.02) bands.update(runTo(t), 0.02);
    expect(bands.calmFor).toBeGreaterThan(1.6);
  });

  it('le contrôle de gain donne la même amplitude à une bande douce et à une bande forte', () => {
    const { runTo } = setup();
    const bands = new MusicBands();
    let kick = 0;
    let hat = 0;
    let rawKick = 0;
    let rawHat = 0;
    for (let t = 0.02; t < 6; t += 0.02) {
      bands.update(runTo(t), 0.02);
      if (t > 3) {
        kick = Math.max(kick, bands.spectrumNorm[0]);
        hat = Math.max(hat, bands.spectrumNorm[5]);
        rawKick = Math.max(rawKick, bands.spectrum[0]);
        rawHat = Math.max(rawHat, bands.spectrum[5]);
      }
    }
    // sans gain, la charleston (brève, douce) reste loin derrière le kick ; avec, elles s'équilibrent
    expect(rawHat / rawKick).toBeLessThan(0.75);
    expect(kick).toBeGreaterThan(0.7);
    expect(hat / kick).toBeGreaterThan(0.8);
    expect(bands.bassN).toBeLessThanOrEqual(1);
  });
});
