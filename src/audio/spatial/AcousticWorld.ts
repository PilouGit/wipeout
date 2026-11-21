import { Vector3 } from 'three';
import { posts, TUNNEL_CEILING, TUNNEL_WALL_MARGIN, WALL_HEIGHT, type Post } from '../../track/features';
import { createFrame, type Track } from '../../track/Track';

/**
 * Géométrie acoustique d'un circuit — calcul pur, sans Web Audio (testable sous Node).
 *
 * Réflexions précoces par la méthode des sources images : pour chaque paroi plane proche
 * (muret gauche, muret droit, plafond de tunnel), on reflète la source par rapport au plan ;
 * le trajet réfléchi a la longueur image → auditeur, et il touche la paroi là où ce segment
 * coupe le plan. Les poteaux (colonnades, portiques) sont traités comme des diffuseurs ponctuels.
 */

export const SPEED_OF_SOUND = 343;
/** Plage des retards de réflexion précoce (s). Au-delà, ce serait un écho distinct : on l'efface. */
export const MIN_DELAY = 0.002;
export const MAX_DELAY = 0.04;

/**
 * Effet Doppler : rapport fréquence perçue / émise.
 * f' = f · (c − v_auditeur·n) / (c − v_source·n), n = direction source → auditeur.
 */
export function dopplerRatio(source: Vector3, sourceVel: Vector3, listener: Vector3, listenerVel: Vector3): number {
  const n = new Vector3().subVectors(listener, source);
  const d = n.length();
  if (d < 1e-6) return 1;
  n.divideScalar(d);
  return (SPEED_OF_SOUND - listenerVel.dot(n)) / Math.max(1, SPEED_OF_SOUND - sourceVel.dot(n));
}

export type TapKind = 'left' | 'right' | 'up' | 'postL' | 'postR';
export const TAP_KINDS: readonly TapKind[] = ['left', 'right', 'up', 'postL', 'postR'];

/** Une réflexion calculée pour une source et un auditeur donnés. */
export interface Reflection {
  readonly kind: TapKind;
  /** Point d'impact sur la paroi (monde). */
  readonly point: Vector3;
  /** Retard par rapport au son direct (s), dans [MIN_DELAY, MAX_DELAY]. */
  delay: number;
  /** Gain relatif au son direct (0 = inactive). */
  gain: number;
  /** Fréquence de coupure de l'absorption de la paroi (Hz). */
  cutoff: number;
}

export function createReflections(): Reflection[] {
  return TAP_KINDS.map((kind) => ({ kind, point: new Vector3(), delay: MIN_DELAY, gain: 0, cutoff: 4000 }));
}

/** Matériaux : coefficient de réflexion et coupure (le métal est brillant, le béton du tunnel plus sourd). */
const GUARDRAIL = { coef: 0.6, cutoff: 5200 };
const TUNNEL_WALL = { coef: 0.85, cutoff: 3200 };
const CEILING = { coef: 0.75, cutoff: 2200 };
const POST = { coef: 0.9, cutoff: 3800 };
/** Largeur (m) de la fenêtre pendant laquelle un poteau renvoie le son quand on le dépasse. */
const POST_WINDOW = 3;
/** Distance d'enfermement progressif aux entrées de tunnel (m). */
const PORTAL_RAMP = 25;
const HASH_CELL = 24;
const OCCLUSION_STEP = 3;
/** Épaisseur de matière (m) pour une occlusion totale. */
const OCCLUSION_FULL = 6;

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class AcousticWorld {
  private readonly postsL: Post[];
  private readonly postsR: Post[];
  private readonly inTunnel: Uint8Array;
  private readonly hash = new Map<string, number[]>();
  private readonly f = createFrame();
  private readonly fp = createFrame();
  private readonly S = new Vector3();
  private readonly W = new Vector3();
  private readonly n = new Vector3();
  private readonly I = new Vector3();
  private readonly P = new Vector3();
  private readonly tmp = new Vector3();

  constructor(readonly track: Track) {
    const all = posts(track);
    this.postsL = all.filter((p) => p.side < 0);
    this.postsR = all.filter((p) => p.side > 0);
    this.inTunnel = new Uint8Array(track.count);
    for (const z of track.zones) {
      if (z.kind !== 'tunnel') continue;
      for (let i = Math.floor(z.from / track.spacing); i <= Math.ceil(z.to / track.spacing) && i < track.count; i++) this.inTunnel[i] = 1;
    }
    for (let i = 0; i < track.count; i++) {
      const key = this.cellKey(track.points[i], 0, 0, 0);
      let list = this.hash.get(key);
      if (!list) this.hash.set(key, (list = []));
      list.push(i);
    }
  }

  /** Enfermement acoustique à l'abscisse s : 1 sous un tunnel, montée progressive aux entrées, 0 à l'air libre. */
  enclosure(s: number): number {
    const m = this.track.mod(s);
    let e = 0;
    for (const z of this.track.zones) {
      if (z.kind === 'tunnel') {
        const outside = m < z.from ? z.from - m : m > z.to ? m - z.to : 0;
        e = Math.max(e, 1 - outside / PORTAL_RAMP);
      } else if (z.kind === 'colonnade' && m >= z.from && m <= z.to) e = Math.max(e, 0.2);
    }
    return Math.max(0, e);
  }

  /**
   * Sondes autour d'une source placée en (s, x) à `lift` au-dessus de la piste, entendue depuis `listener`.
   * Remplit `out` (créé par createReflections) : un élément par TapKind.
   */
  probe(s: number, x: number, lift: number, listener: Vector3, out: Reflection[]): void {
    const t = this.track;
    const f = t.frameAt(s, this.f);
    const S = this.S.copy(f.p).addScaledVector(f.r, x).addScaledVector(f.u, lift);
    const direct = Math.max(0.5, S.distanceTo(listener));
    const tunnel = this.enclosure(s) > 0.5;
    const wallX = t.halfWidth + (tunnel ? TUNNEL_WALL_MARGIN : 0.15);
    const wall = tunnel ? TUNNEL_WALL : GUARDRAIL;
    const top = tunnel ? TUNNEL_CEILING : WALL_HEIGHT;

    for (const r of out) {
      r.gain = 0;
      switch (r.kind) {
        case 'left':
          this.W.copy(f.p).addScaledVector(f.r, -wallX);
          this.planeTap(r, S, listener, direct, this.n.copy(f.r), wall.coef, wall.cutoff, f.p, f.u, top);
          break;
        case 'right':
          this.W.copy(f.p).addScaledVector(f.r, wallX);
          this.planeTap(r, S, listener, direct, this.n.copy(f.r).negate(), wall.coef, wall.cutoff, f.p, f.u, top);
          break;
        case 'up':
          if (!tunnel) break;
          this.W.copy(f.p).addScaledVector(f.u, TUNNEL_CEILING);
          this.planeTap(r, S, listener, direct, this.n.copy(f.u).negate(), CEILING.coef, CEILING.cutoff, f.p, f.u, Infinity);
          break;
        case 'postL':
        case 'postR':
          this.postTap(r, s, lift, S, listener, direct, r.kind === 'postL' ? this.postsL : this.postsR);
          break;
      }
    }
  }

  /** Réflexion sur un plan (point this.W, normale n tournée vers la piste). */
  private planeTap(
    r: Reflection, S: Vector3, L: Vector3, direct: number, n: Vector3,
    coef: number, cutoff: number, base: Vector3, up: Vector3, top: number,
  ): void {
    const W = this.W;
    const dist = this.tmp.subVectors(S, W).dot(n);
    const lisDist = this.tmp.subVectors(L, W).dot(n);
    if (dist <= 0.05 || lisDist <= 0) return; // source ou auditeur derrière la paroi
    const I = this.I.copy(S).addScaledVector(n, -2 * dist);
    const k = dist / (lisDist + dist);
    (r.point as Vector3).lerpVectors(I, L, k);
    // au-dessus d'un muret bas, une partie du son passe par-dessus ; la diffraction sur l'arête
    // en renvoie encore un peu (et la caméra n'est qu'un substitut des oreilles du pilote, plus bas)
    const height = this.tmp.subVectors(r.point, base).dot(up);
    const overTop = top === Infinity ? 1 : 0.45 + 0.55 * smoothstep(top + 3, top, height);
    const path = I.distanceTo(L);
    this.finish(r, path - direct, coef * (direct / path) * overTop, cutoff);
  }

  /** Réflexion sur le poteau le plus proche d'un côté : active seulement quand on le longe. */
  private postTap(r: Reflection, s: number, lift: number, S: Vector3, L: Vector3, direct: number, list: Post[]): void {
    const post = this.nearestPost(list, s);
    if (!post) return;
    const ds = this.track.wrapDiff(post.s - s);
    const window = Math.exp(-((ds / POST_WINDOW) ** 2));
    if (window < 0.01) return;
    const f = this.track.frameAt(post.s, this.fp);
    const P = this.P.copy(f.p).addScaledVector(f.r, post.side * post.x).addScaledVector(f.u, lift);
    (r.point as Vector3).copy(P);
    const path = S.distanceTo(P) + P.distanceTo(L);
    this.finish(r, path - direct, POST.coef * window * (direct / path), POST.cutoff);
  }

  private finish(r: Reflection, extra: number, gain: number, cutoff: number): void {
    const delay = extra / SPEED_OF_SOUND;
    // au-delà de ~40 ms ce n'est plus une réflexion précoce : on l'estompe
    r.gain = gain * smoothstep(MAX_DELAY + 0.005, MAX_DELAY - 0.01, delay);
    r.delay = Math.min(MAX_DELAY, Math.max(MIN_DELAY, delay));
    r.cutoff = cutoff;
  }

  private nearestPost(list: Post[], s: number): Post | null {
    if (!list.length) return null;
    const m = this.track.mod(s);
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].s < m) lo = mid + 1;
      else hi = mid;
    }
    const a = list[(lo - 1 + list.length) % list.length];
    const b = list[lo % list.length];
    return Math.abs(this.track.wrapDiff(a.s - m)) < Math.abs(this.track.wrapDiff(b.s - m)) ? a : b;
  }

  /**
   * Occlusion du trajet direct entre deux points (0 = dégagé, 1 = bloqué) : on échantillonne
   * le segment et on compte la matière traversée (roche ou paroi autour des tunnels, tablier de la piste).
   */
  occlusion(from: Vector3, to: Vector3): number {
    const len = from.distanceTo(to);
    if (len < 2 * OCCLUSION_STEP) return 0;
    let solid = 0;
    const p = this.P;
    for (let d = OCCLUSION_STEP; d < len - OCCLUSION_STEP; d += OCCLUSION_STEP) {
      p.lerpVectors(from, to, d / len);
      if (this.isSolid(p)) solid += OCCLUSION_STEP;
      if (solid >= OCCLUSION_FULL) return 1;
    }
    return solid / OCCLUSION_FULL;
  }

  /** Le point est-il dans de la matière (roche autour d'un tunnel, tablier de la piste) ? */
  isSolid(p: Vector3): boolean {
    const i = this.nearestSample(p);
    if (i < 0) return false;
    const t = this.track;
    const d = this.tmp.subVectors(p, t.points[i]);
    const x = Math.abs(d.dot(t.rights[i]));
    const y = d.dot(t.ups[i]);
    if (this.inTunnel[i]) {
      const insideTube = x < t.halfWidth + TUNNEL_WALL_MARGIN && y > -1 && y < TUNNEL_CEILING;
      return !insideTube && x < 70 && y > -40 && y < 60;
    }
    return x < t.halfWidth && y > -1.1 && y < -0.05;
  }

  private nearestSample(p: Vector3): number {
    let best = -1;
    let bestD = HASH_CELL * HASH_CELL;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const list = this.hash.get(this.cellKey(p, dx, dy, dz));
          if (!list) continue;
          for (const i of list) {
            const d = this.track.points[i].distanceToSquared(p);
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          }
        }
      }
    }
    return best;
  }

  private cellKey(p: Vector3, dx: number, dy: number, dz: number): string {
    return `${Math.floor(p.x / HASH_CELL) + dx},${Math.floor(p.y / HASH_CELL) + dy},${Math.floor(p.z / HASH_CELL) + dz}`;
  }
}
