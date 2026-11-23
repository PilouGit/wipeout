import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Points, PointsMaterial, type Texture, type Vector3 } from 'three';

const HIDDEN_Y = -99999;

/** Pool de particules lumineuses colorées, additives (jaillissements, souffles de feu). */
export class GlowParticles {
  readonly points: Points;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  private readonly base: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly drag: Float32Array;
  private readonly gravity: Float32Array;
  private readonly geo = new BufferGeometry();
  private head = 0;

  constructor(private readonly max: number, map: Texture, size: number) {
    this.pos = new Float32Array(max * 3).fill(HIDDEN_Y);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.base = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.gravity = new Float32Array(max);
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new BufferAttribute(this.col, 3));
    this.points = new Points(
      this.geo,
      new PointsMaterial({ size, map, vertexColors: true, transparent: true, depthWrite: false, blending: AdditiveBlending }),
    );
    this.points.frustumCulled = false;
  }

  /**
   * Émet `count` particules depuis `at`, vitesse `dir` (m/s) ± `spread` dans toutes les directions.
   * `color` en HDR (composantes > 1 = halo du bloom).
   */
  emit(at: Vector3, count: number, dir: Vector3, spread: number, color: Color, life = 1, opts: { drag?: number; gravity?: number } = {}): void {
    for (let k = 0; k < count; k++) {
      const i = this.head;
      this.head = (this.head + 1) % this.max;
      const i3 = i * 3;
      this.pos[i3] = at.x;
      this.pos[i3 + 1] = at.y;
      this.pos[i3 + 2] = at.z;
      this.vel[i3] = dir.x + (Math.random() - 0.5) * 2 * spread;
      this.vel[i3 + 1] = dir.y + (Math.random() - 0.5) * 2 * spread;
      this.vel[i3 + 2] = dir.z + (Math.random() - 0.5) * 2 * spread;
      const tint = 0.7 + Math.random() * 0.6;
      this.base[i3] = color.r * tint;
      this.base[i3 + 1] = color.g * tint;
      this.base[i3 + 2] = color.b * tint;
      this.life[i] = this.maxLife[i] = life * (0.6 + Math.random() * 0.6);
      this.drag[i] = opts.drag ?? 1.2;
      this.gravity[i] = opts.gravity ?? 6;
    }
  }

  update(dt: number): void {
    const { pos, vel, col, base, life, maxLife } = this;
    for (let i = 0; i < this.max; i++) {
      if (life[i] <= 0) continue;
      const i3 = i * 3;
      life[i] -= dt;
      if (life[i] <= 0) {
        pos[i3 + 1] = HIDDEN_Y;
        col[i3] = col[i3 + 1] = col[i3 + 2] = 0;
        continue;
      }
      const k = Math.exp(-this.drag[i] * dt);
      vel[i3] *= k;
      vel[i3 + 1] = vel[i3 + 1] * k - this.gravity[i] * dt;
      vel[i3 + 2] *= k;
      pos[i3] += vel[i3] * dt;
      pos[i3 + 1] += vel[i3 + 1] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;
      // additif : atténuer la couleur = estomper
      const fade = life[i] / maxLife[i];
      const f = fade * fade;
      col[i3] = base[i3] * f;
      col[i3 + 1] = base[i3 + 1] * f;
      col[i3 + 2] = base[i3 + 2] * f;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}
