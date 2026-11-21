import {
  AdditiveBlending, BufferAttribute, BufferGeometry, LineBasicMaterial, LineSegments, Points, PointsMaterial,
  type Camera, type Scene, type Vector3,
} from 'three';
import { clamp } from '../core/math';
import { neon, type Textures } from './textures';

const HIDDEN_Y = -99999;

/** Pool d'étincelles (chocs, frottements, explosions). */
export class Sparks {
  private static readonly MAX = 500;
  private readonly pos = new Float32Array(Sparks.MAX * 3).fill(HIDDEN_Y);
  private readonly vel = new Float32Array(Sparks.MAX * 3);
  private readonly life = new Float32Array(Sparks.MAX);
  private readonly geo = new BufferGeometry();
  private head = 0;

  constructor(scene: Scene, tex: Textures) {
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    const points = new Points(
      this.geo,
      new PointsMaterial({ color: neon(0xffb347, 3), size: 0.45, map: tex.glow, transparent: true, depthWrite: false, blending: AdditiveBlending }),
    );
    points.frustumCulled = false;
    scene.add(points);
  }

  emit(at: Vector3, count: number, spread: number, base?: Vector3): void {
    const { pos, vel, life } = this;
    for (let k = 0; k < count; k++) {
      const i = this.head;
      this.head = (this.head + 1) % Sparks.MAX;
      pos[i * 3] = at.x;
      pos[i * 3 + 1] = at.y;
      pos[i * 3 + 2] = at.z;
      vel[i * 3] = (base?.x ?? 0) + (Math.random() - 0.5) * spread;
      vel[i * 3 + 1] = (base?.y ?? 0) + Math.random() * spread * 0.6;
      vel[i * 3 + 2] = (base?.z ?? 0) + (Math.random() - 0.5) * spread;
      life[i] = 0.4 + Math.random() * 0.5;
    }
  }

  update(dt: number): void {
    const { pos, vel, life } = this;
    for (let i = 0; i < Sparks.MAX; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      if (life[i] <= 0) {
        pos[i * 3 + 1] = HIDDEN_Y;
        continue;
      }
      vel[i * 3 + 1] -= 20 * dt;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}

/** Traînées de vitesse attachées à la caméra. */
export class SpeedLines {
  private static readonly COUNT = 140;
  private readonly pos = new Float32Array(SpeedLines.COUNT * 6);
  private readonly base: { x: number; y: number; z: number }[] = [];
  private readonly geo = new BufferGeometry();
  private readonly material = new LineBasicMaterial({ color: 0xbfefff, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, fog: false });
  private readonly lines: LineSegments;

  constructor(camera: Camera) {
    for (let i = 0; i < SpeedLines.COUNT; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 3 + Math.random() * 12;
      this.base.push({ x: Math.cos(a) * r, y: Math.sin(a) * r * 0.7, z: -5 - Math.random() * 120 });
    }
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.lines = new LineSegments(this.geo, this.material);
    this.lines.frustumCulled = false;
    camera.add(this.lines);
  }

  /** @param intensity 0..~1.7, rapport vitesse / vitesse de pointe (+ bonus boost) */
  update(dt: number, speed: number, intensity: number): void {
    this.material.opacity = clamp((intensity - 0.45) * 1.1, 0, 0.55);
    this.lines.visible = this.material.opacity > 0.01;
    if (!this.lines.visible) return;
    const len = speed * 0.07;
    this.base.forEach((b, i) => {
      b.z += speed * dt * 1.2;
      if (b.z > 2) b.z -= 125;
      this.pos.set([b.x, b.y, b.z, b.x, b.y, b.z - len], i * 6);
    });
    this.geo.attributes.position.needsUpdate = true;
  }
}
