import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, PHYSICS_STEP, TRACK_HALF_WIDTH, type DifficultyKey } from '../src/config';
import { Race } from '../src/race/Race';
import { stepShip } from '../src/race/physics';
import { performance, teamById, TEAMS } from '../src/race/teams';
import { CIRCUITS, circuitById } from '../src/track/circuits';
import { Track } from '../src/track/Track';

const tracks = new Map(CIRCUITS.map((c) => [c.id, new Track(c.layout, TRACK_HALF_WIDTH)]));
const track = tracks.get('neon')!;

/** Fait tourner la course jusqu'à ce que toutes les IA aient fini (ou délai dépassé). */
function simulate(race: Race, maxSeconds: number): void {
  const steps = maxSeconds / PHYSICS_STEP;
  for (let i = 0; i < steps; i++) {
    race.step(PHYSICS_STEP);
    if (race.ships.every((s) => s.isPlayer || s.finished)) return;
  }
}

function expectAllAIsFinish(race: Race, key: DifficultyKey): void {
  const finishes: string[] = [];
  race.events.on('finish', ({ ship }) => finishes.push(ship.name));
  simulate(race, 300);
  const ais = race.ships.filter((s) => !s.isPlayer);
  for (const ai of ais) {
    expect(ai.finished, `${ai.name} n'a pas fini`).toBe(true);
    expect(ai.lapTimes).toHaveLength(3);
    // aucun tour aberrant (bloqué dans un mur, demi-tour…)
    for (const t of ai.lapTimes) expect(t).toBeLessThan((race.track.length / DIFFICULTIES[key].vmax) * 2);
  }
  expect(finishes).toHaveLength(ais.length);
  // le classement des arrivés suit l'ordre d'arrivée
  expect(race.standings().slice(0, ais.length).map((s) => s.name)).toEqual(finishes);
}

describe('Race', () => {
  it('démarre par un compte à rebours de 3 s', () => {
    const race = new Race(track, DIFFICULTIES.pro);
    const counts: number[] = [];
    let go = false;
    race.events.on('countdown', ({ n }) => counts.push(n));
    race.events.on('go', () => (go = true));
    race.start(DIFFICULTIES.pro);
    for (let t = 0; t < 2.9; t += PHYSICS_STEP) race.step(PHYSICS_STEP);
    expect(go).toBe(false);
    for (let t = 0; t < 0.2; t += PHYSICS_STEP) race.step(PHYSICS_STEP);
    expect(counts).toEqual([3, 2, 1]);
    expect(go).toBe(true);
    expect(race.phase).toBe('racing');
  });

  it.each<DifficultyKey>(['novice', 'pro', 'elite'])('toutes les IA finissent 3 tours en %s', (key) => {
    const race = new Race(track, DIFFICULTIES[key]);
    race.start(DIFFICULTIES[key]);
    expectAllAIsFinish(race, key);
  });

  it.each(CIRCUITS.filter((c) => c.id !== 'neon').map((c) => [c.name, c.id] as const))(
    'toutes les IA finissent 3 tours sur %s (loopings, tire-bouchons, tunnels)',
    (_name, id) => {
      const race = new Race(track, DIFFICULTIES.elite);
      race.start(DIFFICULTIES.elite, { track: tracks.get(id)! });
      expect(race.track).toBe(tracks.get(id));
      expectAllAIsFinish(race, 'elite');
    },
  );

  it("donne au joueur l'écurie choisie et des écuries toutes différentes aux autres", () => {
    const race = new Race(track, DIFFICULTIES.pro);
    race.start(DIFFICULTIES.pro, { team: teamById('piraju') });
    expect(race.player.team.id).toBe('piraju');
    const ids = race.ships.map((s) => s.team.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('élimine le joueur quand son bouclier tombe à 0', () => {
    const race = new Race(track, DIFFICULTIES.pro);
    let eliminated = false;
    race.events.on('eliminated', () => (eliminated = true));
    race.start(DIFFICULTIES.pro);
    simulate(race, 4); // fin du compte à rebours
    race.player.energy = 0;
    race.step(PHYSICS_STEP);
    expect(eliminated).toBe(true);
    expect(race.player.dead).toBe(true);
    expect(race.standings().at(-1)).toBe(race.player);
  });
});

describe('écuries', () => {
  const pro = DIFFICULTIES.pro;
  const perf = (id: string) => performance(teamById(id), pro);

  it('traduit les caractéristiques en physique', () => {
    expect(perf('piraju').vmax).toBeGreaterThan(perf('titanus').vmax);
    expect(perf('vekta').accel).toBeGreaterThan(perf('titanus').accel);
    expect(perf('aurora').turn).toBeGreaterThan(perf('boreal').turn);
    expect(perf('titanus').armor).toBeLessThan(perf('piraju').armor);
    expect(perf('titanus').firepower).toBeGreaterThan(perf('piraju').firepower);
    expect(perf('piraju').brake).toBeLessThan(1);
  });

  it('reste équilibré : aucune écurie ne domine en vitesse pure de plus de 7 %', () => {
    const v = TEAMS.map((t) => performance(t, pro).vmax);
    expect(Math.max(...v) / Math.min(...v)).toBeLessThan(1.14);
    for (const t of TEAMS) {
      const s = t.stats;
      expect(s.speed + s.thrust + s.handling + s.shield + s.weapon).toBeGreaterThanOrEqual(30);
      expect(s.speed + s.thrust + s.handling + s.shield + s.weapon).toBeLessThanOrEqual(33);
    }
  });

  it('un engin lourd bouscule un engin léger', () => {
    const race = new Race(track, pro);
    race.start(pro, { team: teamById('titanus') });
    simulate(race, 4);
    const heavy = race.player;
    const light = race.ships.find((s) => s !== heavy)!;
    light.reset(heavy.s, heavy.x + 1, pro, track.length, teamById('piraju'));
    const before = [heavy.x, light.x];
    race.step(PHYSICS_STEP);
    expect(Math.abs(light.x - before[1])).toBeGreaterThan(Math.abs(heavy.x - before[0]) * 2.5);
  });
});

describe('physique', () => {
  it('sans direction, le vaisseau dérive vers l’extérieur du virage et touche le mur', () => {
    const race = new Race(track, DIFFICULTIES.pro);
    race.start(DIFFICULTIES.pro);
    const ship = race.player;
    // départ juste avant le virage le plus serré, plein gaz, sans braquer
    let sharpest = 0;
    for (let i = 0; i < track.count; i++) if (Math.abs(track.curvature[i]) > Math.abs(track.curvature[sharpest])) sharpest = i;
    ship.s = sharpest * track.spacing - 120;
    ship.u = 80;
    ship.input.thrust = 1;
    let hits = 0;
    for (let t = 0; t < 3; t += PHYSICS_STEP) if (stepShip(ship, track, PHYSICS_STEP) > 0 || ship.scrape) hits++;
    expect(hits).toBeGreaterThan(0);
  });

  it('accélère jusqu’à environ la vitesse de pointe en ligne droite', () => {
    const race = new Race(track, DIFFICULTIES.pro);
    race.start(DIFFICULTIES.pro);
    const ship = race.player;
    ship.input.thrust = 1;
    for (let t = 0; t < 12; t += PHYSICS_STEP) {
      stepShip(ship, track, PHYSICS_STEP);
      ship.x = 0; // on neutralise la trajectoire : on ne teste que l'accélération
      ship.psi = 0;
      ship.w = 0;
    }
    expect(ship.u).toBeGreaterThan(ship.perf.vmax * 0.8);
    expect(ship.u).toBeLessThan(ship.perf.vmax * 1.05);
  });

  it('traverse un looping plein gaz sans toucher les murs ni perdre son élan', () => {
    const loopTrack = tracks.get(circuitById('glacier').id)!;
    const loop = loopTrack.zones.find((z) => z.kind === 'magnetic')!;
    const race = new Race(loopTrack, DIFFICULTIES.pro);
    race.start(DIFFICULTIES.pro);
    const ship = race.player;
    ship.s = loop.from - 60;
    ship.u = 80;
    ship.input.thrust = 1;
    let wall = 0;
    while (ship.s < loop.to + 30) if (stepShip(ship, loopTrack, PHYSICS_STEP) > 0) wall++;
    expect(wall).toBe(0);
    expect(Math.abs(ship.x)).toBeLessThan(4);
    expect(ship.u).toBeGreaterThan(70);
  });
});
