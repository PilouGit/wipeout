import { Vector3 } from 'three';
import type { ControlPoint, TrackLayout, ZoneSpec } from './Track';

const UP = new Vector3(0, 1, 0);
const v3 = (p: ControlPoint) => new Vector3(p[0], p[1], p[2]);
const cp = (v: Vector3): ControlPoint => [round(v.x), round(v.y), round(v.z)];
const round = (x: number) => Math.round(x * 100) / 100;

export interface LoopOptions {
  readonly radius?: number;
  /** Décalage latéral en sortie de boucle (pour que la sortie passe à côté de l'entrée). */
  readonly offset?: number;
  /** +1 : la sortie est décalée vers la droite, -1 vers la gauche. */
  readonly side?: 1 | -1;
  /** Ligne droite avant et après la figure. */
  readonly lead?: number;
}

export interface CorkscrewOptions {
  readonly radius?: number;
  /** Longueur parcourue le long de l'axe. */
  readonly length?: number;
  readonly turns?: number;
  /** +1 : vrille vers la droite, -1 vers la gauche. */
  readonly dir?: 1 | -1;
  readonly lead?: number;
}

/**
 * Construit le tracé d'un circuit point par point. Les figures (looping, tire-bouchon)
 * partent dans la direction horizontale courante, définie par les deux derniers points.
 */
export class LayoutBuilder {
  private readonly points: ControlPoint[] = [];
  private readonly zones: ZoneSpec[] = [];

  /** `relief` multiplie les altitudes données à `to` / `jumpTo` (accentue le dénivelé). */
  constructor(private readonly relief = 1) {}

  to(x: number, y: number, z: number): this {
    this.points.push([x, round(y * this.relief), z]);
    return this;
  }

  /**
   * Ligne droite jusqu'à (x, y, z) avec un tremplin au milieu : rampe de `kick` m,
   * puis une descente plus longue où les vaisseaux lancés décollent.
   */
  jumpTo(x: number, y: number, z: number, kick = 6): this {
    const a = v3(this.points[this.points.length - 1]);
    const b = new Vector3(x, y * this.relief, z);
    const at = (f: number, lift: number) => cp(a.clone().lerp(b, f).addScaledVector(UP, lift));
    this.points.push(at(0.3, 0));
    const from = this.here();
    this.points.push(at(0.47, kick), at(0.75, -kick * 0.35));
    this.zones.push({ kind: 'jump', from, to: this.here() });
    this.points.push(cp(b));
    return this;
  }

  /** Indice du dernier point posé (pour délimiter une zone). */
  here(): number {
    return this.points.length - 1;
  }

  tunnel(from: number, to = this.here()): this {
    this.zones.push({ kind: 'tunnel', from, to });
    return this;
  }

  /** Rangées de piliers des deux côtés de la piste, entre deux points posés. */
  colonnade(from: number, to = this.here()): this {
    this.zones.push({ kind: 'colonnade', from, to });
    return this;
  }

  /** Looping vertical complet. */
  loop({ radius = 36, offset = 32, side = 1, lead = 40 }: LoopOptions = {}): this {
    const { last, d, r } = this.heading();
    const p = last.clone().addScaledVector(d, lead);
    this.points.push(cp(p));
    const from = this.here();
    const n = 16;
    for (let k = 1; k <= n; k++) {
      const th = (2 * Math.PI * k) / n;
      const q = p.clone()
        .addScaledVector(d, radius * Math.sin(th))
        .addScaledVector(UP, radius * (1 - Math.cos(th)))
        .addScaledVector(r, (side * offset * k) / n);
      this.points.push(cp(q));
    }
    const to = this.here();
    this.zones.push({ kind: 'magnetic', from, to, center: cp(p.clone().addScaledVector(UP, radius)), axis: cp(r) });
    this.points.push(cp(v3(this.points[to]).addScaledVector(d, lead)));
    return this;
  }

  /** Tire-bouchon : la piste tourne autour d'un axe horizontal tout en avançant. */
  corkscrew({ radius = 10, length = 230, turns = 1, dir = 1, lead = 40 }: CorkscrewOptions = {}): this {
    const { last, d } = this.heading();
    const p = last.clone().addScaledVector(d, lead);
    this.points.push(cp(p));
    const from = this.here();
    const axisOrigin = p.clone().addScaledVector(UP, radius);
    const n = Math.max(12, Math.round(14 * turns));
    for (let k = 1; k <= n; k++) {
      const a = (2 * Math.PI * turns * k * dir) / n;
      const normal = UP.clone().applyAxisAngle(d, a);
      const q = axisOrigin.clone().addScaledVector(normal, -radius).addScaledVector(d, (length * k) / n);
      this.points.push(cp(q));
    }
    const to = this.here();
    this.zones.push({ kind: 'magnetic', from, to, center: cp(axisOrigin), axis: cp(d) });
    this.points.push(cp(v3(this.points[to]).addScaledVector(d, lead)));
    return this;
  }

  build(): TrackLayout {
    return { points: [...this.points], zones: [...this.zones] };
  }

  private heading(): { last: Vector3; d: Vector3; r: Vector3 } {
    if (this.points.length < 2) throw new Error('Il faut deux points pour connaître la direction');
    const last = v3(this.points[this.points.length - 1]);
    const d = last.clone().sub(v3(this.points[this.points.length - 2]));
    d.y = 0;
    d.normalize();
    const r = new Vector3().crossVectors(d, UP).normalize();
    return { last, d, r };
  }
}
