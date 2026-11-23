import { Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { IMuse } from '../src/audio/imuse/IMuse';
import { MusicPulse } from '../src/audio/imuse/MusicPulse';
import type { MusicOutput } from '../src/audio/imuse/types';
import { HOOK, JUMP, MAIN, SOUND } from '../src/audio/score';
import { NEON_RIDGE } from '../src/audio/score/neonRidge';
import { PATTERN, Staging } from '../src/render/music/Staging';

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

const BAR = (4 * 60) / NEON_RIDGE.bpm;
const DT = 1 / 60;

function setup(chunk: number) {
  const out = new NullOutput();
  const pulse = new MusicPulse(out);
  const imuse = new IMuse(pulse, [NEON_RIDGE]);
  imuse.startSound(SOUND.MAIN, chunk);
  imuse.setHook(SOUND.MAIN, HOOK.LAYER, 3);
  const stage = new Staging();
  const camera = new Object3D();
  const log: { t: number; cut: boolean; drop: boolean; level: number; build: number; section: number }[] = [];
  const runTo = (t: number, yawRate = 0) => {
    while (out.t < t - 1e-9) {
      out.t += DT;
      imuse.update();
      camera.rotation.y += yawRate * DT;
      camera.updateMatrixWorld();
      stage.update(DT, pulse.sample(imuse.clock(SOUND.MAIN)), camera);
      log.push({ t: out.t, cut: stage.cutNow, drop: stage.drop, level: stage.level, build: stage.build, section: stage.section });
    }
  };
  return { out, imuse, stage, runTo, log };
}

describe('mise en scène par section', () => {
  it('la coupe tombe quand la nouvelle section est entendue, pas quand elle est planifiée', () => {
    const { imuse, runTo, log } = setup(MAIN.CRUISE);
    runTo(1);
    imuse.setHook(SOUND.MAIN, HOOK.JUMP, JUMP.DRIVE);
    runTo(6 * BAR);
    const cuts = log.filter((l) => l.cut);
    // croisière → montée (fin de la mesure 4), montée → poursuite une mesure plus tard
    expect(cuts.map((c) => c.section)).toEqual([MAIN.FILL_UP, MAIN.DRIVE]);
    expect(cuts[0].t).toBeGreaterThanOrEqual(4 * BAR - 1e-6);
    expect(cuts[0].t).toBeLessThan(4 * BAR + 2 * DT);
    expect(cuts[1].t).toBeGreaterThanOrEqual(5 * BAR - 1e-6);
    expect(cuts[1].t).toBeLessThan(5 * BAR + 2 * DT);
    // le drop : uniquement à l'entrée de la poursuite
    expect(log.filter((l) => l.drop).map((l) => l.section)).toEqual([MAIN.DRIVE]);
  });

  it('la montée retient le décor, puis le drop le libère d’un coup', () => {
    const { imuse, runTo, log, stage } = setup(MAIN.CRUISE);
    runTo(1);
    imuse.setHook(SOUND.MAIN, HOOK.JUMP, JUMP.DRIVE);
    runTo(5 * BAR - 0.05);
    expect(stage.section).toBe(MAIN.FILL_UP);
    expect(stage.build).toBeGreaterThan(0.8);
    expect(stage.intensity).toBeLessThan(0.25);
    runTo(5 * BAR + 0.1);
    expect(stage.section).toBe(MAIN.DRIVE);
    expect(stage.level).toBeGreaterThan(0.95);
    expect(stage.intensity).toBeGreaterThan(0.85);
    expect(log.some((l) => l.section === MAIN.FILL_UP && l.build > 0.5)).toBe(true);
  });

  it('le breakdown est calme et change le motif du sol', () => {
    const { imuse, runTo, stage } = setup(MAIN.DRIVE);
    runTo(1);
    expect(stage.pattern).toBe(PATTERN.RINGS);
    const driveLevel = stage.level;
    imuse.setHook(SOUND.MAIN, HOOK.JUMP, JUMP.BREAKDOWN);
    runTo(4 * BAR + 3);
    expect(stage.section).toBe(MAIN.BREAKDOWN);
    expect(stage.pattern).toBe(PATTERN.CALM);
    expect(stage.previousPattern).toBe(PATTERN.RINGS);
    expect(stage.patternMix).toBe(1);
    expect(stage.level).toBeLessThan(driveLevel * 0.35);
  });

  it('en virage serré, le décor s’efface au profit de la piste', () => {
    const { runTo, stage } = setup(MAIN.DRIVE);
    runTo(2);
    const straight = stage.intensity;
    runTo(3, 1.5); // 1,5 rad/s de lacet
    expect(stage.focus).toBeGreaterThan(0.8);
    expect(stage.intensity).toBeLessThan(straight * 0.65);
    runTo(6);
    expect(stage.focus).toBeLessThan(0.1);
  });
});
