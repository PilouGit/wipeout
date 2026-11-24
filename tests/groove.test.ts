import { describe, expect, it, vi } from 'vitest';
import { DIFFICULTIES, PHYSICS_STEP, TRACK_HALF_WIDTH } from '../src/config';
import { Groove, GrooveAI, MAX_STREAK, type BeatSample } from '../src/race/Groove';
import { Race } from '../src/race/Race';
import { Ship } from '../src/race/Ship';
import { TEAMS } from '../src/race/teams';
import { CIRCUITS } from '../src/track/circuits';
import { Track } from '../src/track/Track';

const BPS = 2.5; // 150 BPM
const at = (beats: number): BeatSample => ({ beats, inBar: ((beats % 4) + 4) % 4, bps: BPS });
const ship = () => {
  const s = new Ship(true, TEAMS[0], DIFFICULTIES.pro);
  s.u = 80;
  return s;
};

describe('groove (actions sur le temps)', () => {
  it('juge parfait, en rythme et contretemps selon l’écart au temps entendu', () => {
    const g = new Groove();
    const s = ship();
    expect(g.act('pulse', s, at(10 + 0.03 * BPS))!.grade).toBe('perfect'); // 30 ms en retard
    expect(g.act('pulse', s, at(11 - 0.09 * BPS))!.grade).toBe('good'); // 90 ms en avance
    expect(g.act('pulse', s, at(12.4))!.grade).toBe('miss');
    expect(g.streak).toBe(0);
  });

  it('la série fait grandir l’impulsion, le premier temps compte davantage', () => {
    const g = new Groove();
    const gains: number[] = [];
    for (let b = 1; b <= 6; b++) {
      const s = ship();
      g.act('pulse', s, at(b));
      gains.push(s.u - 80);
    }
    expect(g.streak).toBe(6);
    // temps 1, 2, 3 (contretemps de mesure) puis 4 = premier temps de la mesure suivante
    expect(gains[1]).toBeGreaterThan(gains[0]);
    expect(gains[3]).toBeGreaterThan(gains[2] * 1.2);
    expect(Math.max(...gains)).toBeLessThan(8);
  });

  it('marteler la touche ne rapporte qu’une fois par temps, et un contretemps freine', () => {
    const g = new Groove();
    const s = ship();
    expect(g.act('pulse', s, at(4))).not.toBeNull();
    expect(g.act('pulse', s, at(4.05))).toBeNull();
    const before = s.u;
    g.act('pulse', s, at(4.5));
    expect(s.u).toBeLessThan(before);
    expect(g.streak).toBe(0);
  });

  it('pad et atterrissage : bonus sur le temps, aucune pénalité à contretemps', () => {
    const g = new Groove();
    const s = ship();
    s.boostTime = 1.3;
    expect(g.act('pad', s, at(8 + 0.1 * BPS))!.grade).toBe('good'); // fenêtre élargie pour les actions subies
    expect(s.boostTime).toBeGreaterThan(1.3);
    const u = s.u;
    expect(g.act('land', s, at(9.5))).toBeNull();
    expect(s.u).toBe(u);
    expect(g.act('land', s, at(9))!.grade).toBe('perfect');
    expect(s.u).toBeGreaterThan(u);
  });

  it('la série plafonne et s’éteint après 4 mesures sans réussite', () => {
    const g = new Groove();
    for (let b = 0; b < 20; b++) g.act('pulse', ship(), at(b));
    expect(g.streak).toBe(MAX_STREAK);
    g.update(4 * 4 / BPS - 0.1, at(30));
    expect(g.streak).toBe(MAX_STREAK);
    g.update(0.2, at(31));
    expect(g.streak).toBe(0);
    expect(g.best).toBe(MAX_STREAK);
  });

  it('en course : la touche jouée en rythme fait gagner du temps, sans musique elle ne fait rien', () => {
    const track = new Track(CIRCUITS[0].layout, TRACK_HALF_WIDTH);
    const run = (music: boolean, press: boolean) => {
      // tirages (armes, IA) identiques d'une course à l'autre
      let seed = 12345;
      const rnd = vi.spyOn(Math, 'random').mockImplementation(() => ((seed = (seed * 16807) % 2147483647) / 2147483647));
      const race = new Race(track, DIFFICULTIES.pro);
      race.start(DIFFICULTIES.pro, { rand: () => 0.5 });
      race.beat = music ? () => at(race.time * BPS) : () => null;
      let lastBeat = -1;
      for (let t = 0; t < 40; t += PHYSICS_STEP) {
        const pl = race.player;
        if (race.phase === 'racing') (race as unknown as { drivers: Map<unknown, { update(s: unknown, dt: number, c: unknown): void }>; aiContext: unknown }).drivers.get(pl)!.update(pl, PHYSICS_STEP, (race as unknown as { aiContext: unknown }).aiContext);
        const beat = Math.round(race.time * BPS);
        if (press && race.phase === 'racing' && beat !== lastBeat && Math.abs(race.time * BPS - beat) < 0.02) {
          race.player.input.pulse = true;
          lastBeat = beat;
        }
        race.step(PHYSICS_STEP);
      }
      rnd.mockRestore();
      return { s: race.player.s, best: race.groove.best };
    };
    const idle = run(true, false);
    const onBeat = run(true, true);
    expect(onBeat.best).toBe(MAX_STREAK);
    // un avantage qui se sent, sans écraser le pilotage
    expect(onBeat.s).toBeGreaterThan(idle.s * 1.02);
    expect(onBeat.s).toBeLessThan(idle.s * 1.06);
    // sans musique, la touche n'a aucun effet
    const silent = run(false, false);
    const silentPress = run(false, true);
    expect(silentPress.best).toBe(0);
    expect(silentPress.s).toBeCloseTo(silent.s, 6);
  });
});

describe('les IA groovent aussi', () => {
  const rival = () => {
    const s = new Ship(false, TEAMS[1], DIFFICULTIES.pro);
    s.u = 80;
    return s;
  };

  it('une fois par temps, selon la probabilité de la difficulté, jamais pour le joueur', () => {
    const ai = new GrooveAI();
    const a = rival();
    const p = ship();
    // plusieurs pas dans le même temps : une seule impulsion
    for (const b of [0.01, 0.2, 0.6]) ai.update([a, p], at(b), 1);
    expect(a.u).toBeGreaterThan(80);
    const once = a.u;
    ai.update([a, p], at(0.9), 1);
    expect(a.u).toBe(once);
    expect(p.u).toBe(80);
    // probabilité nulle : rien
    const b = rival();
    const ai0 = new GrooveAI();
    for (let k = 0; k < 16; k++) ai0.update([b], at(k + 0.01), 0);
    expect(b.u).toBe(80);
  });

  it('un bon groover (élite) gagne plus qu’un débutant, la série grandit et retombe sur un temps manqué', () => {
    const gain = (chance: number) => {
      let seed = 7;
      const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const ai = new GrooveAI();
      const s = rival();
      for (let k = 0; k < 64; k++) ai.update([s], at(k + 0.01), chance, rand);
      return s.u - 80;
    };
    expect(gain(DIFFICULTIES.elite.groove)).toBeGreaterThan(gain(DIFFICULTIES.novice.groove) * 1.5);
    // série parfaite de 64 temps : la touche ne doit pas valoir plus que quelques % de la vitesse de pointe
    // (impulsion par temps ≤ ~4 % de la vitesse de pointe, freinée ensuite par la traînée)
    const perBeat = gain(1) / 64;
    expect(perBeat).toBeLessThan(DIFFICULTIES.pro.vmax * 0.04);
  });
});
