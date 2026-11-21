import { AdditiveBlending, Mesh, MeshBasicMaterial, PlaneGeometry, type Object3D } from 'three';
import type { Pad } from '../race/pads';
import type { Track } from '../track/Track';
import { neon, type Textures } from './textures';

export class PadView {
  private readonly itemMaterials: { pad: Pad; material: MeshBasicMaterial }[] = [];

  constructor(parent: Object3D, track: Track, pads: readonly Pad[], private readonly tex: Textures) {
    for (const pad of pads) {
      const boost = pad.type === 'boost';
      const geo = new PlaneGeometry(boost ? 4 : 3.2, boost ? 7 : 3.2);
      geo.rotateX(-Math.PI / 2);
      const material = new MeshBasicMaterial({
        map: boost ? tex.chevron : tex.item,
        color: neon(0xffffff, boost ? 1.6 : 1.4),
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      });
      const mesh = new Mesh(geo, material);
      track.place(mesh, pad.s, pad.x, 0.06);
      parent.add(mesh);
      if (!boost) this.itemMaterials.push({ pad, material });
    }
  }

  update(dt: number, time: number): void {
    this.tex.chevron.offset.y = (this.tex.chevron.offset.y - dt * 1.6) % 1;
    for (const { pad, material } of this.itemMaterials) material.opacity = 0.75 + Math.sin(time * 6 + pad.id) * 0.25;
  }
}
