import { describe, expect, it } from 'vitest';
import { AIRBRAKE_TURN_RATE, DIFFICULTIES, TRACK_HALF_WIDTH, TURN_RATE } from '../src/config';
import { CIRCUITS } from '../src/track/circuits';
import { createFrame, Track } from '../src/track/Track';

describe.each(CIRCUITS.map((c) => [c.name, new Track(c.layout, TRACK_HALF_WIDTH)] as const))('%s', (_name, track) => {
  it('a une longueur de tour raisonnable', () => {
    expect(track.length).toBeGreaterThan(2700);
    expect(track.length).toBeLessThan(4500);
  });

  it('a des virages passables à pleine vitesse avec les aérofreins', () => {
    const maxYaw = TURN_RATE + AIRBRAKE_TURN_RATE;
    expect((DIFFICULTIES.pro.vmax * 1.06) / track.minRadius()).toBeLessThan(maxYaw);
  });

  it('ne se recoupe pas : deux portions distantes de 150 m sur la piste ne se touchent pas', () => {
    const n = track.count;
    const minGap = Math.ceil(150 / track.spacing);
    let closest = Infinity;
    for (let i = 0; i < n; i += 2) {
      for (let j = i + minGap; j < n; j += 2) {
        if (n - j + i < minGap) continue;
        closest = Math.min(closest, track.points[i].distanceTo(track.points[j]));
      }
    }
    // largeur de piste + murs + marge
    expect(closest).toBeGreaterThan(2 * TRACK_HALF_WIDTH + 4);
  });

  it('produit des repères orthonormés, à plat hors des figures', () => {
    const f = createFrame();
    for (let s = 0; s < track.length; s += 7) {
      track.frameAt(s, f);
      expect(f.t.length()).toBeCloseTo(1, 3);
      expect(Math.abs(f.t.dot(f.r))).toBeLessThan(0.03);
      expect(Math.abs(f.t.dot(f.u))).toBeLessThan(0.03);
      if (!track.zoneAt(s, 'magnetic')) expect(f.u.y).toBeGreaterThan(0.8);
    }
  });

  it("tourne la surface sans à-coup (moins de 5° tous les 2 m)", () => {
    for (let i = 0; i < track.count; i++) {
      const a = track.ups[i];
      const b = track.ups[(i + 1) % track.count];
      expect(Math.acos(Math.min(1, a.dot(b)))).toBeLessThan((5 * Math.PI) / 180);
    }
  });

  it('retourne bien le vaisseau dans les loopings et tire-bouchons', () => {
    for (const z of track.zones.filter((z) => z.kind === 'magnetic')) {
      const f = createFrame();
      let minUp = 1;
      for (let s = z.from; s <= z.to; s += 2) minUp = Math.min(minUp, track.frameAt(s, f).u.y);
      expect(minUp).toBeLessThan(-0.95);
    }
  });

  it('gère les abscisses cumulées et négatives', () => {
    const L = track.length;
    expect(track.mod(-10)).toBeCloseTo(L - 10);
    expect(track.mod(2 * L + 5)).toBeCloseTo(5);
    expect(track.wrapDiff(L - 10)).toBeCloseTo(-10);
    expect(track.wrapDiff(10 - L)).toBeCloseTo(10);
  });
});

describe('catalogue', () => {
  it('propose des loopings, des tire-bouchons et des tunnels', () => {
    const kinds = CIRCUITS.flatMap((c) => c.layout.zones.map((z) => z.kind));
    expect(kinds.filter((k) => k === 'magnetic').length).toBeGreaterThanOrEqual(4);
    expect(kinds.filter((k) => k === 'tunnel').length).toBeGreaterThanOrEqual(4);
  });
});
