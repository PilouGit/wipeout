import { Vector3, type PerspectiveCamera } from 'three';
import { HOVER_HEIGHT } from '../config';
import { clamp, damp } from '../core/math';
import type { Ship } from '../race/Ship';
import { createFrame, type Track } from '../track/Track';

export type CameraMode = 'chase' | 'cockpit';

const frame = createFrame();
const frameAhead = createFrame();
const shipFwd = new Vector3();
const shipPos = new Vector3();
const target = new Vector3();

/**
 * Caméra de poursuite. On lisse la *direction* et pas la position :
 * à 100 m/s un lissage de position laisserait la caméra des dizaines de mètres derrière.
 */
export class ChaseCamera {
  mode: CameraMode = 'chase';
  private readonly smoothFwd = new Vector3(1, 0, 0);
  private readonly smoothUp = new Vector3(0, 1, 0);
  private shake = 0;
  private fov = 70;
  private flybyS = 0;
  private flybyX = 0;

  constructor(private readonly camera: PerspectiveCamera) {}

  toggleMode(): void {
    this.mode = this.mode === 'chase' ? 'cockpit' : 'chase';
  }

  addShake(amount: number, max = 1): void {
    this.shake = Math.min(max, this.shake + amount);
  }

  /** @returns le rapport vitesse / vitesse de pointe, utile pour les effets */
  follow(dt: number, ship: Ship, track: Track): number {
    const cam = this.camera;
    const f = track.frameAt(ship.s, frame);
    const cp = Math.cos(ship.psi);
    const sp = Math.sin(ship.psi);
    shipFwd.copy(f.t).multiplyScalar(cp).addScaledVector(f.r, sp);
    this.smoothFwd.lerp(shipFwd, damp(7, dt)).normalize();
    this.smoothUp.lerp(f.u, damp(5, dt)).normalize();
    shipPos.copy(f.p).addScaledVector(f.r, ship.x).addScaledVector(f.u, HOVER_HEIGHT);
    const ratio = clamp(ship.speed / ship.perf.vmax, 0, 1.4);

    if (this.mode === 'chase') {
      cam.position.copy(shipPos).addScaledVector(this.smoothFwd, -(8.5 + ratio * 1.2)).addScaledVector(this.smoothUp, 2.9);
      cam.up.copy(this.smoothUp);
      cam.lookAt(target.copy(shipPos).addScaledVector(this.smoothFwd, 14).addScaledVector(this.smoothUp, 0.8));
    } else {
      cam.position.copy(shipPos).addScaledVector(shipFwd, 3.2).addScaledVector(f.u, 0.75);
      cam.up.copy(f.u);
      cam.lookAt(target.copy(cam.position).addScaledVector(shipFwd, 20));
    }

    if (this.shake > 0) {
      cam.position.x += (Math.random() - 0.5) * this.shake * 0.8;
      cam.position.y += (Math.random() - 0.5) * this.shake * 0.8;
      this.shake = Math.max(0, this.shake - dt * 2.2);
    }

    const targetFov = 68 + ratio * 16 + (ship.boostTime > 0 ? 6 : 0);
    this.fov += (targetFov - this.fov) * Math.min(1, dt * 4);
    this.setFov(this.fov);
    return ratio;
  }

  /** Survol automatique de la piste pour l'écran titre. */
  flyby(dt: number, time: number, track: Track): void {
    this.flybyS += dt * 45;
    const f = track.frameAt(this.flybyS, frame);
    const ahead = track.frameAt(this.flybyS + 40, frameAhead);
    this.flybyX = Math.sin(time * 0.3) * 6;
    this.camera.position.copy(f.p).addScaledVector(f.u, 7).addScaledVector(f.r, this.flybyX);
    this.camera.up.copy(f.u);
    this.camera.lookAt(target.copy(ahead.p).addScaledVector(ahead.u, 2));
    this.setFov(70);
  }

  /** Abscisse courante du survol (pour y placer le vaisseau du menu). */
  get flybyDistance(): number {
    return this.flybyS;
  }

  /** Décalage latéral courant de la caméra de survol. */
  get flybyOffset(): number {
    return this.flybyX;
  }

  private setFov(fov: number): void {
    if (this.camera.fov === fov) return;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }
}
