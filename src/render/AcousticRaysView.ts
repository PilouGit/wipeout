import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, LineBasicMaterial, LineSegments, Points, PointsMaterial,
  type Scene,
} from 'three';
import type { TapKind } from '../audio/spatial/AcousticWorld';
import type { SpatialDebug } from '../audio/spatial/WipeoutAudioEngine';

export const TAP_COLORS: Readonly<Record<TapKind, number>> = {
  left: 0x2ef2ff, right: 0xff3fb4, up: 0xffe14a, postL: 0x7dff4a, postR: 0x7dff4a,
};

const MAX_SEGMENTS = 64;

/**
 * Visualisation 3D des réflexions : un segment de chaque source vers chacun de ses points
 * d'impact (couleur = paroi, luminosité = gain), un point lumineux à l'impact.
 * Les segments impact → auditeur ne sont pas tracés : l'auditeur est la caméra, ils se réduiraient à un point.
 */
export class AcousticRaysView {
  private readonly lines: LineSegments;
  private readonly hits: Points;
  private readonly linePos = new Float32Array(MAX_SEGMENTS * 6);
  private readonly lineCol = new Float32Array(MAX_SEGMENTS * 6);
  private readonly hitPos = new Float32Array(MAX_SEGMENTS * 3);
  private readonly hitCol = new Float32Array(MAX_SEGMENTS * 3);
  private readonly c = new Color();

  constructor(scene: Scene) {
    const lg = new BufferGeometry();
    lg.setAttribute('position', new BufferAttribute(this.linePos, 3));
    lg.setAttribute('color', new BufferAttribute(this.lineCol, 3));
    this.lines = new LineSegments(lg, new LineBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthTest: false }));
    const pg = new BufferGeometry();
    pg.setAttribute('position', new BufferAttribute(this.hitPos, 3));
    pg.setAttribute('color', new BufferAttribute(this.hitCol, 3));
    this.hits = new Points(pg, new PointsMaterial({ vertexColors: true, size: 0.9, transparent: true, blending: AdditiveBlending, depthTest: false }));
    this.lines.renderOrder = this.hits.renderOrder = 10;
    this.lines.frustumCulled = this.hits.frustumCulled = false;
    this.visible = false;
    scene.add(this.lines, this.hits);
  }

  set visible(v: boolean) {
    this.lines.visible = this.hits.visible = v;
  }

  update(debug: SpatialDebug): void {
    let n = 0;
    for (const v of debug.voices.values()) {
      if (!v.audible) continue;
      for (const r of v.reflections) {
        if (r.gain < 0.01 || n >= MAX_SEGMENTS) continue;
        const k = Math.min(1, 0.25 + r.gain * 2.5);
        this.c.set(TAP_COLORS[r.kind]).multiplyScalar(k * 2);
        this.linePos.set([v.position.x, v.position.y, v.position.z, r.point.x, r.point.y, r.point.z], n * 6);
        this.lineCol.set([this.c.r, this.c.g, this.c.b, this.c.r, this.c.g, this.c.b], n * 6);
        this.hitPos.set([r.point.x, r.point.y, r.point.z], n * 3);
        this.hitCol.set([this.c.r, this.c.g, this.c.b], n * 3);
        n++;
      }
    }
    const lg = this.lines.geometry;
    lg.setDrawRange(0, n * 2);
    lg.attributes.position.needsUpdate = true;
    lg.attributes.color.needsUpdate = true;
    const pg = this.hits.geometry;
    pg.setDrawRange(0, n);
    pg.attributes.position.needsUpdate = true;
    pg.attributes.color.needsUpdate = true;
  }
}
