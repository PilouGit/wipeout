import { AIRBRAKE_TURN_RATE, TURN_RATE } from '../config';
import { clamp } from '../core/math';
import type { Track } from '../track/Track';
import type { Pad } from './pads';
import type { Ship } from './Ship';

export interface AIContext {
  readonly track: Track;
  readonly ships: readonly Ship[];
  readonly pads: readonly Pad[];
  /** Vaisseau de référence pour l'élastique (le joueur), ou null pour le désactiver. */
  readonly rubberBand: Ship | null;
}

/** Pilote automatique : trajectoire, vitesse de passage en courbe, évitement et armes. */
export class AIDriver {
  private lane = 0;
  private laneTarget = 0;
  private laneTimer = 0;
  private itemTimer = 0;

  constructor(public skill: number) {}

  reset(skill: number): void {
    this.skill = skill;
    this.lane = this.laneTarget = this.laneTimer = this.itemTimer = 0;
  }

  onItemPicked(): void {
    this.itemTimer = 1 + Math.random() * 3;
  }

  update(ship: Ship, dt: number, ctx: AIContext): void {
    const { track } = ctx;
    const inp = ship.input;
    const half = track.halfWidth;

    // Variation lente de la ligne pour que les IA ne roulent pas en file indienne
    this.laneTimer -= dt;
    if (this.laneTimer <= 0) {
      this.laneTimer = 2 + Math.random() * 4;
      this.laneTarget = (Math.random() * 2 - 1) * 4;
    }
    this.lane += (this.laneTarget - this.lane) * Math.min(1, dt * 0.8);

    const v = Math.max(12, ship.u);
    const look = 18 + v * 0.45;
    let kAhead = 0;
    for (let j = 1; j <= 4; j++) kAhead += track.curvatureAt(ship.s + (look * j) / 2);
    kAhead /= 4;
    let kMax = 0;
    for (let j = 0; j <= 10; j++) kMax = Math.max(kMax, Math.abs(track.curvatureAt(ship.s + j * v * 0.22)));

    // Ligne cible : corde intérieure, pads de boost, évitement
    let tx = clamp(kAhead * 650, -1, 1) * half * 0.55 + this.lane;
    const sm = track.mod(ship.s);
    for (const p of ctx.pads) {
      if (p.type !== 'boost') continue;
      const d = track.wrapDiff(p.s - sm);
      if (d > 0 && d < 110) {
        tx = p.x;
        break;
      }
    }
    for (const o of ctx.ships) {
      if (o === ship || o.dead) continue;
      const d = track.wrapDiff(o.s - ship.s);
      if (d > 0 && d < 22 && Math.abs(o.x - tx) < 3.2) tx = o.x + (o.x > 0 ? -4.2 : 4.2);
    }
    tx = clamp(tx, -(half - 3), half - 3);

    // Direction : anticipation de la courbure + correction de cap
    const desiredPsi = Math.atan2(tx - ship.x, look);
    const yaw = track.curvatureAt(ship.s) * v + (desiredPsi - ship.psi) * 2.6;
    const turn = TURN_RATE * ship.perf.turn;
    inp.steer = clamp(yaw / turn, -1, 1);
    const overflow = Math.abs(yaw) - turn * 0.95;
    inp.airbrakeLeft = overflow > 0 && yaw < 0 ? 1 : 0;
    inp.airbrakeRight = overflow > 0 && yaw > 0 ? 1 : 0;

    // Vitesse : élastique léger + limite de passage en courbe
    let rubber = 1;
    const ref = ctx.rubberBand;
    if (ref && ref !== ship && !ref.dead && !ref.finished) rubber = clamp(1 + (ref.s - ship.s) * 0.00025, 0.95, 1.08);
    ship.vmaxMul = this.skill * rubber;
    const cornerSpeed = ((TURN_RATE + AIRBRAKE_TURN_RATE) * ship.perf.turn * 0.82) / Math.max(1e-4, kMax);
    const target = Math.min(ship.perf.vmax * ship.vmaxMul * 1.1, cornerSpeed);
    inp.thrust = ship.u < target ? 1 : 0;
    inp.brake = ship.u > target + 6 / ship.perf.brake ? 1 : 0;

    this.updateWeapons(ship, dt, ctx);
  }

  private updateWeapons(ship: Ship, dt: number, ctx: AIContext): void {
    if (!ship.item) return;
    this.itemTimer -= dt;
    if (this.itemTimer > 0) return;
    const gapTo = (o: Ship) => ctx.track.wrapDiff(o.s - ship.s);
    const others = ctx.ships.filter((o) => o !== ship && !o.dead);
    let use: boolean;
    switch (ship.item) {
      case 'IMPULSION':
        use = others.some((o) => gapTo(o) > 10 && gapTo(o) < 250);
        break;
      case 'MINES':
        use = others.some((o) => -gapTo(o) > 10 && -gapTo(o) < 120);
        break;
      default:
        use = true;
    }
    if (use || this.itemTimer < -6) ship.input.fire = true;
  }
}
