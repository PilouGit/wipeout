import { clamp } from '../core/math';
import type { Track } from '../track/Track';
import type { ItemKind, Ship } from './Ship';

export interface Projectile {
  s: number;
  x: number;
  readonly speed: number;
  readonly owner: Ship;
  life: number;
  target: Ship | null;
}

export interface Mine {
  /** Abscisse modulo la longueur du tour : une mine touche à chaque passage. */
  readonly s: number;
  readonly x: number;
  readonly owner: Ship;
  safeTime: number;
  life: number;
}

export interface HitSpec {
  /** Facteur appliqué à la vitesse. */
  readonly speedFactor: number;
  readonly damage: number;
}

export const PROJECTILE_HIT: HitSpec = { speedFactor: 0.35, damage: 18 };
export const MINE_HIT: HitSpec = { speedFactor: 0.5, damage: 12 };

const ITEM_WEIGHTS: readonly (readonly [ItemKind, number])[] = [
  ['TURBO', 0.3], ['IMPULSION', 0.3], ['MINES', 0.22], ['BOUCLIER', 0.18],
];

export function randomItem(rand: () => number = Math.random): ItemKind {
  let r = rand();
  for (const [kind, weight] of ITEM_WEIGHTS) {
    if (r < weight) return kind;
    r -= weight;
  }
  return 'BOUCLIER';
}

/** Projectiles et mines en vol. Purement logique : le rendu lit `projectiles` et `mines`. */
export class WeaponSystem {
  readonly projectiles: Projectile[] = [];
  readonly mines: Mine[] = [];

  constructor(public track: Track) {}

  clear(): void {
    this.projectiles.length = 0;
    this.mines.length = 0;
  }

  /** Consomme l'arme du vaisseau. Retourne l'arme utilisée, ou null s'il n'en avait pas. */
  use(ship: Ship): ItemKind | null {
    const item = ship.item;
    ship.item = null;
    if (!item) return null;
    switch (item) {
      case 'TURBO':
        ship.boostTime = 2.2;
        ship.u += 18;
        break;
      case 'BOUCLIER':
        ship.shieldTime = 5;
        break;
      case 'IMPULSION':
        this.projectiles.push({ s: ship.s + 4, x: ship.x, speed: Math.max(ship.u, 30) + 70, owner: ship, life: 4, target: null });
        break;
      case 'MINES': {
        const half = this.track.halfWidth;
        for (let k = 0; k < 3; k++) {
          this.mines.push({
            s: this.track.mod(ship.s - 6 - k * 9),
            x: clamp(ship.x + (k - 1) * 2.5, -half + 2, half - 2),
            owner: ship,
            safeTime: 1,
            life: 45,
          });
        }
        break;
      }
    }
    return item;
  }

  update(dt: number, ships: readonly Ship[], onHit: (ship: Ship, hit: HitSpec, by: Ship) => void): void {
    const track = this.track;

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      if (!p.target || p.target.dead) p.target = this.nearestAhead(p, ships);
      if (p.target) p.x += clamp(p.target.x - p.x, -1, 1) * 22 * dt;
      p.s += p.speed * dt;
      const hit = ships.find(
        (o) => o !== p.owner && !o.dead && Math.abs(track.wrapDiff(o.s - p.s)) < 3.5 && Math.abs(o.x - p.x) < 2.4,
      );
      if (hit) onHit(hit, PROJECTILE_HIT, p.owner);
      if (hit || p.life <= 0) this.projectiles.splice(i, 1);
    }

    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i];
      m.life -= dt;
      m.safeTime -= dt;
      const hit = ships.find(
        (o) =>
          !o.dead &&
          !(o === m.owner && m.safeTime > 0) &&
          Math.abs(track.wrapDiff(track.mod(o.s) - m.s)) < 2.5 &&
          Math.abs(o.x - m.x) < 2.2,
      );
      if (hit) onHit(hit, MINE_HIT, m.owner);
      if (hit || m.life <= 0) this.mines.splice(i, 1);
    }
  }

  private nearestAhead(p: Projectile, ships: readonly Ship[]): Ship | null {
    let best: Ship | null = null;
    let bestGap = 600;
    for (const o of ships) {
      if (o === p.owner || o.dead) continue;
      const gap = this.track.wrapDiff(o.s - p.s);
      if (gap > 0 && gap < bestGap) {
        bestGap = gap;
        best = o;
      }
    }
    return best;
  }
}
