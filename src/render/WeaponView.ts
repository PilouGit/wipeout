import { AdditiveBlending, Mesh, MeshBasicMaterial, OctahedronGeometry, SphereGeometry, Sprite, SpriteMaterial, type Scene } from 'three';
import { HOVER_HEIGHT } from '../config';
import type { Mine, Projectile, WeaponSystem } from '../race/WeaponSystem';
import type { Track } from '../track/Track';
import { neon, type Textures } from './textures';

/** Synchronise des meshes avec les projectiles et mines de la simulation. */
export class WeaponView {
  private readonly meshes = new Map<Projectile | Mine, Mesh>();
  private readonly projectileGeo = new SphereGeometry(0.55, 12, 8);
  private readonly projectileMat = new MeshBasicMaterial({ color: neon(0x66e0ff, 4) });
  private readonly projectileGlow: SpriteMaterial;
  private readonly mineGeo = new OctahedronGeometry(0.8);
  private readonly mineMat = new MeshBasicMaterial({ color: neon(0xff2a2a, 3), wireframe: true });

  constructor(private readonly scene: Scene, tex: Textures) {
    this.projectileGlow = new SpriteMaterial({ map: tex.glow, color: neon(0x66e0ff, 2), blending: AdditiveBlending, depthWrite: false, transparent: true });
  }

  update(weapons: WeaponSystem, track: Track, time: number): void {
    const alive = new Set<Projectile | Mine>();
    for (const p of weapons.projectiles) {
      alive.add(p);
      track.place(this.meshFor(p, () => this.createProjectile()), p.s, p.x, HOVER_HEIGHT);
    }
    for (const m of weapons.mines) {
      alive.add(m);
      const mesh = this.meshFor(m, () => new Mesh(this.mineGeo, this.mineMat));
      track.place(mesh, m.s, m.x, 0.9);
      mesh.rotateY((time * 3) % (Math.PI * 2));
    }
    for (const [obj, mesh] of this.meshes) {
      if (alive.has(obj)) continue;
      this.scene.remove(mesh);
      this.meshes.delete(obj);
    }
  }

  private meshFor(obj: Projectile | Mine, create: () => Mesh): Mesh {
    let mesh = this.meshes.get(obj);
    if (!mesh) {
      mesh = create();
      this.scene.add(mesh);
      this.meshes.set(obj, mesh);
    }
    return mesh;
  }

  private createProjectile(): Mesh {
    const mesh = new Mesh(this.projectileGeo, this.projectileMat);
    const glow = new Sprite(this.projectileGlow);
    glow.scale.set(4, 4, 1);
    mesh.add(glow);
    return mesh;
  }
}
