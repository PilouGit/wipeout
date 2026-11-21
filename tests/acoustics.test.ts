import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  AcousticWorld, createReflections, dopplerRatio, MAX_DELAY, MIN_DELAY, SPEED_OF_SOUND, TAP_KINDS, type TapKind,
} from '../src/audio/spatial/AcousticWorld';
import { HOVER_HEIGHT, TRACK_HALF_WIDTH } from '../src/config';
import { circuitById } from '../src/track/circuits';
import { createFrame, Track } from '../src/track/Track';

const make = (id: string) => {
  const track = new Track(circuitById(id).layout, TRACK_HALF_WIDTH);
  return { track, world: new AcousticWorld(track) };
};
const neon = make('neon');
const f = createFrame();

/** Position de la caméra de poursuite : derrière et au-dessus du vaisseau. */
function chaseListener(track: Track, s: number, x: number): Vector3 {
  track.frameAt(s - 8.5, f);
  return f.p.clone().addScaledVector(f.r, x).addScaledVector(f.u, HOVER_HEIGHT + 2.9);
}

function probe(world: AcousticWorld, s: number, x: number, listener = chaseListener(world.track, s, x)) {
  const out = createReflections();
  world.probe(s, x, HOVER_HEIGHT, listener, out);
  const by = (k: TapKind) => out[TAP_KINDS.indexOf(k)];
  return { out, by, listener };
}

/** Une abscisse en ligne droite, loin de tout tunnel, colonnade et portique. */
function openStraight(world: AcousticWorld): number {
  const t = world.track;
  for (let s = 100; s < t.length; s += 10) {
    if (world.enclosure(s) === 0 && Math.abs(t.curvatureAt(s)) < 0.002 && !t.zones.some((z) => s > z.from - 60 && s < z.to + 60)) {
      const r = probe(world, s, 0);
      if (r.by('postL').gain === 0 && r.by('postR').gain === 0) return s;
    }
  }
  throw new Error('pas de ligne droite dégagée');
}

describe('réflexions précoces (sources images)', () => {
  const { track, world } = neon;
  const s = openStraight(world);

  it('renvoie une réflexion courte depuis la droite quand on rase le mur droit', () => {
    const { by, listener } = probe(world, s, track.halfWidth - 1.5);
    const right = by('right');
    expect(right.gain).toBeGreaterThan(0.2);
    expect(right.delay).toBeGreaterThanOrEqual(MIN_DELAY);
    expect(right.delay).toBeLessThan(0.015);
    track.frameAt(s, f);
    expect(right.point.clone().sub(f.p).dot(f.r)).toBeCloseTo(track.halfWidth + 0.15, 1);
    expect(right.point.clone().sub(listener).dot(f.r)).toBeGreaterThan(0);
    expect(by('left').gain).toBeLessThan(0.02);
    expect(by('up').gain).toBe(0);
  });

  it('calcule le retard comme la différence de trajet divisée par la vitesse du son', () => {
    const x = 7;
    const { by, listener } = probe(world, s, x);
    const right = by('right');
    track.frameAt(s, f);
    const S = f.p.clone().addScaledVector(f.r, x).addScaledVector(f.u, HOVER_HEIGHT);
    const reflected = S.distanceTo(right.point) + right.point.distanceTo(listener);
    expect(right.delay).toBeCloseTo((reflected - S.distanceTo(listener)) / SPEED_OF_SOUND, 4);
  });

  it("n'a pas de réflexion précoce forte au milieu de la piste (zone ouverte)", () => {
    const { out } = probe(world, s, 0);
    for (const r of out) expect(r.gain).toBeLessThan(0.05);
  });

  it('garde tous les retards dans la plage 2–40 ms', () => {
    for (let k = 0; k < 400; k++) {
      const { out } = probe(world, Math.random() * track.length, (Math.random() * 2 - 1) * (track.halfWidth - 1.4));
      for (const r of out) {
        expect(r.delay).toBeGreaterThanOrEqual(MIN_DELAY);
        expect(r.delay).toBeLessThanOrEqual(MAX_DELAY);
        expect(r.gain).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('tunnels', () => {
  const { track, world } = make('glacier');
  const tunnel = track.zones.find((z) => z.kind === 'tunnel')!;
  const mid = (tunnel.from + tunnel.to) / 2;

  it("règle l'enfermement : 100 % dedans, progressif à l'entrée, 0 % dehors", () => {
    expect(world.enclosure(mid)).toBe(1);
    const atPortal = world.enclosure(tunnel.from - 12);
    expect(atPortal).toBeGreaterThan(0.3);
    expect(atPortal).toBeLessThan(0.7);
    expect(world.enclosure(tunnel.from - 80)).toBe(0);
  });

  it('ajoute la réflexion du plafond sous le tunnel', () => {
    const up = probe(world, mid, 0).by('up');
    expect(up.gain).toBeGreaterThan(0.1);
    track.frameAt(mid, f);
    expect(up.point.clone().sub(f.p).dot(f.u)).toBeCloseTo(10.5, 0);
  });

  it("occulte un concurrent dans le tunnel entendu depuis l'extérieur, pas à l'air libre", () => {
    track.frameAt(mid, f);
    const inside = f.p.clone().addScaledVector(f.u, HOVER_HEIGHT);
    const beside = f.p.clone().addScaledVector(f.r, 45).addScaledVector(f.u, 3);
    expect(world.occlusion(inside, beside)).toBe(1);
    const ahead = track.pointAt(mid + 20, 0, HOVER_HEIGHT, new Vector3());
    expect(world.occlusion(inside, ahead)).toBe(0);
    const s = openStraight(world);
    const a = track.pointAt(s, -5, HOVER_HEIGHT, new Vector3());
    const b = track.pointAt(s + 30, 5, HOVER_HEIGHT, new Vector3());
    expect(world.occlusion(a, b)).toBe(0);
  });
});

describe('colonnade', () => {
  const { track, world } = neon;
  const zone = track.zones.find((z) => z.kind === 'colonnade')!;

  it('produit des réflexions saccadées en longeant les piliers (flutter echo)', () => {
    const gains: number[] = [];
    for (let s = zone.from + 20; s < zone.to - 20; s += 0.5) gains.push(probe(world, s, track.halfWidth - 2).by('postR').gain);
    let peaks = 0;
    for (let i = 1; i < gains.length - 1; i++) if (gains[i] > gains[i - 1] && gains[i] >= gains[i + 1] && gains[i] > 0.05) peaks++;
    const expected = (zone.to - zone.from - 40) / 12;
    expect(peaks).toBeGreaterThan(expected * 0.8);
    expect(peaks).toBeLessThan(expected * 1.25);
    expect(Math.min(...gains)).toBeLessThan(0.05);
  });
});

describe('Doppler', () => {
  const o = new Vector3();
  const still = new Vector3();
  it('monte quand la source approche, descend quand elle s’éloigne', () => {
    const L = new Vector3(100, 0, 0);
    expect(dopplerRatio(o, new Vector3(50, 0, 0), L, still)).toBeCloseTo(SPEED_OF_SOUND / (SPEED_OF_SOUND - 50), 6);
    expect(dopplerRatio(o, new Vector3(-50, 0, 0), L, still)).toBeLessThan(1);
    expect(dopplerRatio(o, new Vector3(0, 0, 80), L, still)).toBeCloseTo(1, 6);
    const v = new Vector3(60, 0, 0);
    expect(dopplerRatio(o, v, L, v)).toBeCloseTo(1, 6);
  });
});
