import { describe, expect, it } from 'vitest';
import { TRACK_HALF_WIDTH } from '../src/config';
import { musicCues, planDrop, SYNC_MAX, SYNC_MIN, trimDrop, type DropPlan } from '../src/game/DropSync';
import { CIRCUITS } from '../src/track/circuits';
import { Track } from '../src/track/Track';

const BPS = 150 / 60;

/**
 * Simule la décision image par image : à chaque image le directeur replanifie ; quand il arme le hook,
 * le saut a lieu à la barre suivante, puis une mesure de montée. Renvoie l'écart drop − arrivée (s).
 */
function simulate(distance: number, speed: number, phase: number, lead = 0.2, dt = 1 / 60): number {
  let beats = phase; // temps entendus
  let factor = 1;
  let t = 0;
  let dropAt: number | null = null; // en temps entendus
  let keep: number | null = null;
  let lastInBar = ((phase % 4) + 4) % 4;
  while (t < 30) {
    const eta = (distance - speed * t);
    if (eta <= 0) break;
    if (dropAt === null) {
      const inBar = ((beats % 4) + 4) % 4;
      if (keep !== null && inBar < lastInBar - 2) keep--;
      lastInBar = inBar;
      const ahead = Math.floor((beats + lead * BPS * factor) / 4) - Math.floor(beats / 4);
      const plan: DropPlan = planDrop(eta / speed, inBar, BPS, factor, ahead, keep)!;
      factor = plan.factor;
      keep = plan.bars;
      // le hook est lu par l'ordonnanceur à la prochaine barre située au-delà de l'avance
      if (plan.arm) dropAt = Math.ceil((beats + lead * BPS * factor) / 4) * 4 + 4;
    } else {
      factor = trimDrop(eta / speed, dropAt - beats, BPS);
    }
    beats += BPS * factor * dt;
    t += dt;
    if (dropAt !== null && beats >= dropAt) return t - distance / speed;
  }
  return Infinity;
}

describe('synchro du drop sur le circuit', () => {
  it.each([
    [600, 80, 0], [600, 80, 1.7], [900, 70, 3.2], [1100, 85, 2.4], [450, 60, 0.4],
  ])('rendez-vous à %i m, %i m/s, phase %f : le drop tombe à moins d’un dixième de seconde', (d, v, phase) => {
    expect(Math.abs(simulate(d, v, phase))).toBeLessThan(0.1);
  });

  it('suit un joueur qui accélère après la décision', () => {
    // la vitesse change à mi-chemin : la replanification et le trim de tempo rattrapent
    let beats = 0.8, factor = 1, s = 0, v = 60, dropAt: number | null = null;
    const target = 800, dt = 1 / 60;
    for (let t = 0; s < target; t += dt) {
      if (t > 4) v = 75;
      const eta = (target - s) / v;
      if (dropAt === null) {
        const ahead = Math.floor((beats + 0.2 * BPS * factor) / 4) - Math.floor(beats / 4);
        const plan = planDrop(eta, ((beats % 4) + 4) % 4, BPS, factor, ahead)!;
        factor = plan.factor;
        if (plan.arm) dropAt = Math.ceil((beats + 0.2 * BPS * factor) / 4) * 4 + 4;
      } else factor = trimDrop(eta, dropAt - beats, BPS);
      beats += BPS * factor * dt;
      s += v * dt;
    }
    expect(dropAt).not.toBeNull();
    expect(Math.abs(beats - dropAt!)).toBeLessThan(0.1 * BPS);
  });

  it('le tempo reste dans sa plage, et le plus près possible du tempo courant', () => {
    for (let eta = 2; eta < 14; eta += 0.37) {
      for (let phase = 0; phase < 4; phase += 0.5) {
        const p = planDrop(eta, phase, BPS, 1, phase > 3.5 ? 1 : 0)!;
        expect(p.factor).toBeGreaterThanOrEqual(SYNC_MIN);
        expect(p.factor).toBeLessThanOrEqual(SYNC_MAX);
        // au-delà de 6 s, il existe toujours une barre atteignable sans sortir de la plage
        if (eta > 6) expect(Math.abs(p.error)).toBeLessThan(1e-6);
      }
    }
  });

  it('chaque circuit a ses rendez-vous : décollages des tremplins, sorties de tunnel', () => {
    for (const c of CIRCUITS) {
      const track = new Track(c.layout, TRACK_HALF_WIDTH);
      const cues = musicCues(track);
      const jumps = track.zones.filter((z) => z.kind === 'jump');
      expect(cues.drops.length, c.id).toBeGreaterThan(0);
      // le décollage est dans le tremplin, sur une bosse
      for (const z of jumps) {
        const near = cues.drops.find((s) => s >= z.from && s <= z.to);
        if (near !== undefined) expect(track.pitchAt(near)).toBeLessThan(0);
      }
      // rendez-vous espacés
      const d = [...cues.drops, cues.drops[0] + track.length];
      for (let i = 1; i < d.length; i++) if (cues.drops.length > 1) expect(d[i] - d[i - 1]).toBeGreaterThanOrEqual(700);
      // chaque respiration (tunnel) débouche sur un drop
      for (const z of cues.calms) expect(cues.drops).toContain(z.to);
    }
  });
});
