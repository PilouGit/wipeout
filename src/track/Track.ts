import { CatmullRomCurve3, Matrix4, Vector3, type Object3D } from 'three';
import { clamp, wrapAngle } from '../core/math';

export type ControlPoint = readonly [number, number, number];

/**
 * Portion particulière de la piste, bornée par deux points de contrôle.
 * - magnetic : looping / tire-bouchon. La surface est orientée vers un axe (center + axis) :
 *   la normale est la direction du point de piste vers cet axe. Le vaisseau y reste plaqué.
 * - tunnel : portion couverte (visuel, acoustique : réverbération, plafond, occlusion).
 * - colonnade : rangées de piliers le long des murs (réflexions saccadées, « flutter echo »).
 */
export interface ZoneSpec {
  readonly kind: 'magnetic' | 'tunnel' | 'colonnade';
  readonly from: number;
  readonly to: number;
  readonly center?: ControlPoint;
  readonly axis?: ControlPoint;
}

export interface TrackLayout {
  readonly points: readonly ControlPoint[];
  readonly zones: readonly ZoneSpec[];
}

/** Zone résolue en abscisses (from < to, sans passer par la ligne de départ). */
export interface Zone {
  readonly kind: ZoneSpec['kind'];
  readonly from: number;
  readonly to: number;
}

/**
 * Repère local de la piste à une abscisse donnée.
 * - t : tangente (sens de course)
 * - r : droite (incliné avec le dévers)
 * - u : normale de la surface
 * - k : courbure en lacet dans le plan de la piste (rad/m), positive pour un virage à droite
 */
export interface TrackFrame {
  readonly p: Vector3;
  readonly t: Vector3;
  readonly r: Vector3;
  readonly u: Vector3;
  k: number;
}

export function createFrame(): TrackFrame {
  return { p: new Vector3(), t: new Vector3(), r: new Vector3(), u: new Vector3(), k: 0 };
}

const SAMPLE_SPACING = 2;
const BANK_GAIN = 26;
const MAX_BANK = 0.42;
const WORLD_UP = new Vector3(0, 1, 0);

/**
 * Piste échantillonnée à pas constant le long de l'abscisse curviligne `s`.
 * Toute position sur la piste s'exprime en (s, x) : distance parcourue et décalage latéral.
 * `s` peut être non borné (tours cumulés) : les accès sont faits modulo la longueur.
 */
export class Track {
  readonly length: number;
  readonly count: number;
  readonly spacing: number;
  readonly points: Vector3[] = [];
  readonly tangents: Vector3[] = [];
  readonly rights: Vector3[] = [];
  readonly ups: Vector3[] = [];
  readonly curvature: Float32Array;
  /** 1 dans les zones magnétiques (loopings, tire-bouchons), 0 ailleurs. */
  readonly magnetic: Uint8Array;
  readonly zones: Zone[] = [];

  private readonly placeFrame = createFrame();
  private readonly basis = new Matrix4();
  private readonly left = new Vector3();

  constructor(layout: TrackLayout, readonly halfWidth: number) {
    const control = layout.points;
    const curve = new CatmullRomCurve3(control.map(([x, y, z]) => new Vector3(x, y, z)), true, 'centripetal');
    this.length = curve.getLength();
    this.count = Math.round(this.length / SAMPLE_SPACING);
    this.spacing = this.length / this.count;
    const n = this.count;

    const spaced = curve.getSpacedPoints(n);
    for (let i = 0; i < n; i++) this.points.push(spaced[i].clone());
    for (let i = 0; i < n; i++) {
      this.tangents.push(new Vector3().subVectors(this.points[(i + 1) % n], this.points[(i - 1 + n) % n]).normalize());
    }

    // Zones : indices d'échantillons des points de contrôle qui les bornent
    const cpIndex = this.locate(control);
    this.magnetic = new Uint8Array(n);
    const fieldUp: (Vector3 | null)[] = new Array(n).fill(null);
    for (const z of layout.zones) {
      const a = cpIndex[z.from];
      const b = cpIndex[z.to];
      if (!(b > a)) throw new Error(`Zone ${z.kind} ${z.from}→${z.to} mal bornée`);
      this.zones.push({ kind: z.kind, from: a * this.spacing, to: b * this.spacing });
      if (z.kind !== 'magnetic') continue;
      const c = new Vector3(...z.center!);
      const ax = new Vector3(...z.axis!).normalize();
      for (let i = a; i <= b; i++) {
        this.magnetic[i] = 1;
        // direction vers l'axe, sans sa composante le long de l'axe
        const v = new Vector3().subVectors(c, this.points[i]);
        fieldUp[i] = v.addScaledVector(ax, -v.dot(ax));
      }
    }
    const nearMagnetic = this.smooth(Float32Array.from(this.magnetic), 10).map((v) => Math.min(1, v * 3));

    // Dévers : d'après la courbure horizontale, nul dans les zones magnétiques
    const yawCurv = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = this.tangents[(i - 1 + n) % n];
      const b = this.tangents[(i + 1) % n];
      if (this.magnetic[i] || Math.abs(a.y) > 0.9 || Math.abs(b.y) > 0.9) continue;
      yawCurv[i] = wrapAngle(Math.atan2(b.z, b.x) - Math.atan2(a.z, a.x)) / (2 * this.spacing);
    }
    const bankCurvature = this.smooth(yawCurv, 14);

    for (let i = 0; i < n; i++) {
      const t = this.tangents[i];
      const u = new Vector3();
      const field = fieldUp[i];
      if (field && field.lengthSq() > 1e-6) u.copy(field);
      else u.crossVectors(new Vector3().crossVectors(t, WORLD_UP), t);
      u.addScaledVector(t, -u.dot(t)).normalize();
      const r = new Vector3().crossVectors(t, u).normalize();
      const bank = clamp(bankCurvature[i] * BANK_GAIN, -MAX_BANK, MAX_BANK) * (1 - nearMagnetic[i]);
      r.applyAxisAngle(t, bank);
      u.applyAxisAngle(t, bank);
      this.rights.push(r);
      this.ups.push(u);
    }
    this.smoothUps(4);

    // Courbure dans le plan de la piste : rotation de la tangente vers la droite
    const raw = new Float32Array(n);
    const dt = new Vector3();
    for (let i = 0; i < n; i++) {
      dt.subVectors(this.tangents[(i + 1) % n], this.tangents[(i - 1 + n) % n]);
      // Dans les figures, la piste guide le vaisseau (rail magnétique) : la légère dérive
      // latérale d'un looping n'a pas à être compensée au volant.
      raw[i] = (dt.dot(this.rights[i]) / (2 * this.spacing)) * (1 - nearMagnetic[i]);
    }
    this.curvature = this.smooth(raw, 3);
  }

  /** Indice d'échantillon de chaque point de contrôle (recherche monotone le long du tour). */
  private locate(control: readonly ControlPoint[]): number[] {
    const n = this.count;
    const out: number[] = [];
    const p = new Vector3();
    let start = 0;
    for (const c of control) {
      p.set(c[0], c[1], c[2]);
      let best = start;
      let bestD = Infinity;
      for (let j = 0; j < n; j++) {
        const i = start + j;
        if (i >= n) break;
        const d = this.points[i].distanceTo(p);
        if (d < bestD) {
          bestD = d;
          best = i;
        } else if (bestD < this.spacing * 1.5 && d > bestD + 8) break;
      }
      out.push(best);
      start = best;
    }
    return out;
  }

  /** Adoucit les raccords d'orientation (entrées/sorties de figures) puis ré-orthonormalise. */
  private smoothUps(radius: number): void {
    const n = this.count;
    const src = this.ups.map((u) => u.clone());
    for (let i = 0; i < n; i++) {
      const u = this.ups[i].set(0, 0, 0);
      for (let j = -radius; j <= radius; j++) u.add(src[(i + j + n) % n]);
      const t = this.tangents[i];
      u.addScaledVector(t, -u.dot(t)).normalize();
      this.rights[i].crossVectors(t, u).normalize();
    }
  }

  private smooth(arr: Float32Array, radius: number): Float32Array {
    const n = this.count;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = -radius; j <= radius; j++) sum += arr[(i + j + n) % n];
      out[i] = sum / (2 * radius + 1);
    }
    return out;
  }

  private index(s: number): { i: number; j: number; f: number } {
    const n = this.count;
    let q = s / this.spacing;
    q = ((q % n) + n) % n;
    const fi = Math.floor(q);
    const i = fi % n;
    return { i, j: (i + 1) % n, f: q - fi };
  }

  /** Repère interpolé à l'abscisse `s`. */
  frameAt(s: number, out: TrackFrame): TrackFrame {
    const { i, j, f } = this.index(s);
    out.p.lerpVectors(this.points[i], this.points[j], f);
    out.t.lerpVectors(this.tangents[i], this.tangents[j], f).normalize();
    out.r.lerpVectors(this.rights[i], this.rights[j], f).normalize();
    out.u.lerpVectors(this.ups[i], this.ups[j], f).normalize();
    out.k = this.curvature[i] * (1 - f) + this.curvature[j] * f;
    return out;
  }

  curvatureAt(s: number): number {
    const { i, j, f } = this.index(s);
    return this.curvature[i] * (1 - f) + this.curvature[j] * f;
  }

  /** La zone du type demandé qui contient `s`, s'il y en a une. */
  zoneAt(s: number, kind: Zone['kind']): Zone | undefined {
    const m = this.mod(s);
    return this.zones.find((z) => z.kind === kind && m >= z.from && m <= z.to);
  }

  /** Abscisse ramenée dans [0, length[. */
  mod(s: number): number {
    const l = this.length;
    return ((s % l) + l) % l;
  }

  /** Écart signé le plus court entre deux abscisses, dans [-length/2, length/2[. */
  wrapDiff(d: number): number {
    const l = this.length;
    return ((d % l) + l * 1.5) % l - l / 2;
  }

  /** Position monde d'un point (s, x) à une hauteur `lift` au-dessus de la surface. */
  pointAt(s: number, x: number, lift: number, out: Vector3): Vector3 {
    const f = this.frameAt(s, this.placeFrame);
    return out.copy(f.p).addScaledVector(f.r, x).addScaledVector(f.u, lift);
  }

  /** Positionne et oriente un objet sur la piste (axe local +Z vers l'avant, +X vers la gauche). */
  place(obj: Object3D, s: number, x: number, lift = 0): void {
    const f = this.frameAt(s, this.placeFrame);
    obj.position.copy(f.p).addScaledVector(f.r, x).addScaledVector(f.u, lift);
    this.left.copy(f.r).negate();
    this.basis.makeBasis(this.left, f.u, f.t);
    obj.quaternion.setFromRotationMatrix(this.basis);
  }

  /** Rayon de virage le plus serré (m). */
  minRadius(): number {
    let max = 0;
    for (const k of this.curvature) max = Math.max(max, Math.abs(k));
    return 1 / max;
  }
}
