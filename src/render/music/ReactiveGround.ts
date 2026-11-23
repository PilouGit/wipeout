import {
  Color, CylinderGeometry, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshStandardMaterial, Vector3,
} from 'three';
import { BEATS_PER_BAR } from '../../audio/imuse/types';
import { GROUND_Y } from '../../config';
import type { Track } from '../../track/Track';
import { follow, SPECTRUM_SIZE, type MusicBands } from './MusicBands';
import { PATTERN, type Pattern, type Staging } from './Staging';

/** Hauteur d'une colonne au repos (m). */
const REST = 0.5;
/** Hauteur maximale loin de la piste (m). */
const MAX_HEIGHT = 48;
/** Garde sous la piste : une colonne ne monte jamais à moins de cette distance du dessous. */
const TRACK_CLEARANCE = 7;
/** Vitesse de propagation des ondes de kick depuis le centre (m/s) et demi-largeur du front (m). */
const WAVE_SPEED = 320;
const WAVE_WIDTH = 55;
/** Taux de lissage (1/s) : montée nerveuse, descente fluide. */
const RISE = 22;
const FALL = 3.4;
/** Égaliseur en spirale : nombre de bras, torsion (tours du centre au bord), tours par temps. */
const ARMS = 2;
const TWIST = 1.3;
const SPIN = 1 / 32;
/** Amplitudes (m) : spectre, ondes de kick, étincelles. */
const SPECTRUM_AMP = 26;
const WAVE_AMP = 12;
const SPARK_AMP = 5;

export interface GroundField {
  readonly center: Vector3;
  readonly radius: number;
}

/**
 * Sol réactif : un champ de colonnes hexagonales métalliques cerclées de néon, sous le circuit.
 * La hauteur et l'éclat de chaque colonne suivent la musique : le spectre, normalisé par bande,
 * est déplié en spirale tournante sur tout le champ, chaque kick lance une onde circulaire depuis le centre,
 * et la pulsation du tempo fait onduler l'ensemble.
 */
export class ReactiveGround {
  readonly mesh: InstancedMesh;
  readonly field: GroundField;
  private readonly count: number;
  /** Par colonne : distance au centre normalisée et en mètres, hauteur max, graine aléatoire. */
  private readonly rn: Float32Array;
  private readonly dc: Float32Array;
  /** Angle autour du centre, en tours (0..1). */
  private readonly ang: Float32Array;
  private readonly maxH: Float32Array;
  private readonly seed: Float32Array;
  /** Éclat permis (0..1) : les colonnes qui bordent la piste restent sobres pour la lisibilité. */
  private readonly near: Float32Array;
  private paletteShift = 0;
  private readonly height: InstancedBufferAttribute;
  private readonly glow: InstancedBufferAttribute;
  private readonly uniforms = { uShift: { value: 0 }, uC0: { value: new Color() }, uC1: { value: new Color() } };

  constructor(track: Track, colors: readonly [number, number], lite: boolean) {
    const R = lite ? 24 : 15;
    const pts = track.points;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const center = new Vector3((minX + maxX) / 2, GROUND_Y, (minZ + maxZ) / 2);
    const radius = Math.hypot(maxX - minX, maxZ - minZ) / 2 + 260;
    this.field = { center, radius };

    // grille hexagonale « pointe vers z » : colonnes espacées de √3·R, rangées de 1,5·R
    const cells: [number, number][] = [];
    const dx = Math.sqrt(3) * R;
    const dz = 1.5 * R;
    const rows = Math.ceil(radius / dz);
    for (let row = -rows; row <= rows; row++) {
      const offset = (row & 1) * dx * 0.5;
      const cols = Math.ceil(radius / dx) + 1;
      for (let col = -cols; col <= cols; col++) {
        const x = col * dx + offset;
        const z = row * dz;
        if (x * x + z * z <= radius * radius) cells.push([center.x + x, center.z + z]);
      }
    }
    const n = (this.count = cells.length);
    this.rn = new Float32Array(n);
    this.dc = new Float32Array(n);
    this.ang = new Float32Array(n);
    this.maxH = new Float32Array(n);
    this.seed = new Float32Array(n);
    this.near = new Float32Array(n);
    const tint = new Float32Array(n);

    // hauteur permise : sous la piste, on garde de la place pour les vaisseaux
    const reach = (track.halfWidth + R + 6) ** 2;
    const geo = new CylinderGeometry(R * 0.93, R * 0.93, 1, 6, 1);
    geo.translate(0, 0.5, 0);
    this.height = new InstancedBufferAttribute(new Float32Array(n).fill(REST), 1).setUsage(DynamicDrawUsage);
    this.glow = new InstancedBufferAttribute(new Float32Array(n), 1).setUsage(DynamicDrawUsage);
    geo.setAttribute('aHeight', this.height);
    geo.setAttribute('aGlow', this.glow);
    geo.setAttribute('aTint', new InstancedBufferAttribute(tint, 1));

    const mat = new MeshStandardMaterial({ color: 0x14141c, metalness: 0.85, roughness: 0.32, flatShading: true });
    this.uniforms.uC0.value.set(colors[0]);
    this.uniforms.uC1.value.set(colors[1]);
    this.patchMaterial(mat, R * 0.93);
    const mesh = (this.mesh = new InstancedMesh(geo, mat, n));
    mesh.frustumCulled = false; // la hauteur est appliquée dans le shader
    const m = new Matrix4();
    cells.forEach(([x, z], i) => {
      mesh.setMatrixAt(i, m.makeTranslation(x, GROUND_Y, z));
      const d = Math.hypot(x - center.x, z - center.z);
      this.dc[i] = d;
      this.rn[i] = d / radius;
      this.ang[i] = fract(Math.atan2(z - center.z, x - center.x) / (Math.PI * 2));
      this.seed[i] = fract(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453);
      tint[i] = Math.min(1, this.rn[i] * 1.1 + (this.seed[i] - 0.5) * 0.15);
      let cap = MAX_HEIGHT;
      let nearest = Infinity;
      for (let k = 0; k < pts.length; k += 2) {
        const p = pts[k];
        const ex = p.x - x;
        const ez = p.z - z;
        const e2 = ex * ex + ez * ez;
        nearest = Math.min(nearest, e2);
        if (e2 < reach) cap = Math.min(cap, p.y - GROUND_Y - TRACK_CLEARANCE);
      }
      this.maxH[i] = Math.max(REST, cap);
      // de 35 % au bord de la piste à 100 % à 90 m
      this.near[i] = 0.35 + 0.65 * Math.min(1, Math.max(0, (Math.sqrt(nearest) - track.halfWidth - R) / 90));
    });
  }

  update(dt: number, bands: MusicBands, stage: Staging): void {
    if (dt <= 0) return;
    const f = bands.features;
    const spec = bands.spectrumNorm;
    const spin = f.beats * SPIN;
    const ages = f.waveAge;
    const strengths = f.waveStrength;
    const nw = ages.length;
    const fronts = ages.map((a) => a * WAVE_SPEED);
    const fades = ages.map((a, k) => strengths[k] * Math.exp(-a * 0.8));
    const beatPhase = f.beats * Math.PI * 0.5; // une ondulation par temps
    const sparkSlot = Math.floor(f.beats * 4); // une double croche
    const swell = 1.5 + 4.5 * bands.energy;
    const h = this.height.array as Float32Array;
    const g = this.glow.array as Float32Array;
    const last = SPECTRUM_SIZE - 1;
    // mise en scène : dynamique de la section, retenue avant le drop, effacement en virage, coupe
    const level = stage.intensity;
    const calmLevel = Math.max(0.12, level);
    const pop = stage.cut * 9;
    const mix = stage.patternMix;
    const cur = stage.pattern;
    const prev = stage.previousPattern;
    const at = (p: Pattern, ang: number, rn: number) => this.bandPosition(p, ang, rn, spin) * last;

    for (let i = 0; i < this.count; i++) {
      const rn = this.rn[i];
      const d = this.dc[i];
      // spectre (normalisé) déplié selon le motif de la section ; fondu enchaîné après une coupe
      let s = sample(spec, at(cur, this.ang[i], rn), last) * (cur === PATTERN.CALM ? 0.25 : 1);
      if (mix < 1) s = s * mix + sample(spec, at(prev, this.ang[i], rn), last) * (prev === PATTERN.CALM ? 0.25 : 1) * (1 - mix);
      // ondes des kicks
      let w = 0;
      for (let k = 0; k < nw; k++) {
        const x = (d - fronts[k]) / WAVE_WIDTH;
        if (x > -3 && x < 3) w += fades[k] * Math.exp(-x * x);
      }
      // houle au tempo, qui part du centre
      const ripple = 0.5 + 0.5 * Math.sin(d * 0.018 - beatPhase);
      // étincelles sur les charlestons
      const spark = fract(this.seed[i] * 7.31 + sparkSlot * 0.618) < bands.highN * 0.08 ? 1 : 0;

      const lift = (s * SPECTRUM_AMP + w * WAVE_AMP + spark * SPARK_AMP) * level + ripple * swell * calmLevel + pop * (1 - rn * 0.5);
      const target = Math.min(this.maxH[i], REST + lift);
      h[i] = follow(h[i], target, dt, RISE, FALL);
      const glowTarget = Math.min(1.6, (s * 0.85 + w * 0.9 + spark * 1.2) * level + ripple * bands.energy * 0.15 * calmLevel + stage.cut * 0.8) * this.near[i];
      g[i] = follow(g[i], glowTarget, dt, RISE * 1.5, FALL * 1.4);
    }
    this.height.needsUpdate = true;
    this.glow.needsUpdate = true;
    // la teinte glisse avec la note de basse (12 demi-tons = un tour) ; la palette de la section change net à la coupe
    this.paletteShift = follow(this.paletteShift, (((f.bassNote % 12) + 12) % 12) / 12, dt, 3, 3);
    this.uniforms.uShift.value = this.paletteShift + stage.palette;
  }

  /** Position (0..1, graves → aigus) dans le spectre d'une colonne, selon le motif. */
  private bandPosition(p: Pattern, ang: number, rn: number, spin: number): number {
    switch (p) {
      case PATTERN.SPIRAL:
        // bras de spirale tournant au tempo : chaque bande couvre tout le champ
        return Math.abs(fract(ang * ARMS + rn * TWIST - spin) * 2 - 1);
      case PATTERN.RINGS:
        // anneaux concentriques qui partent du centre à chaque temps
        return Math.abs(fract(rn * 3 - spin * 8) * 2 - 1);
      case PATTERN.SECTORS:
        // secteurs tournants, en sens inverse de la spirale
        return Math.abs(fract(ang * 6 + spin * 2) * 2 - 1);
      default:
        return rn;
    }
  }

  /** Au repos (ou hors musique) : ondulation lente pour que le sol vive quand même. */
  idle(dt: number, beats: number): void {
    const h = this.height.array as Float32Array;
    const g = this.glow.array as Float32Array;
    for (let i = 0; i < this.count; i++) {
      const t = REST + 0.8 * (0.5 + 0.5 * Math.sin(this.dc[i] * 0.02 - beats * BEATS_PER_BAR * 0.4));
      h[i] = follow(h[i], Math.min(this.maxH[i], t), dt, RISE, FALL);
      g[i] = follow(g[i], 0.05, dt, RISE, FALL);
    }
    this.height.needsUpdate = true;
    this.glow.needsUpdate = true;
  }

  /** Étire les colonnes (aHeight) et trace les arêtes au néon, plus vives avec aGlow. */
  private patchMaterial(mat: MeshStandardMaterial, radius: number): void {
    const u = this.uniforms;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute float aHeight;
          attribute float aGlow;
          attribute float aTint;
          varying vec3 vLocal;
          varying float vGlow;
          varying float vTint;
          varying float vH;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vLocal = position;
          vGlow = aGlow;
          vTint = aTint;
          vH = aHeight;
          transformed.y *= aHeight;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uShift;
          uniform vec3 uC0;
          uniform vec3 uC1;
          varying vec3 vLocal;
          varying float vGlow;
          varying float vTint;
          varying float vH;`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          {
            const float R = ${radius.toFixed(3)};
            const float W = 0.45;
            vec2 p = vLocal.xz;
            // arêtes verticales : sommets de l'hexagone tous les 60°
            float sector = PI / 3.0;
            float a = atan(p.x, p.y);
            float e = abs(fract(a / sector + 0.5) - 0.5) * sector * R;
            float side = 1.0 - smoothstep(W * 0.4, W, e);
            // bord du dessus : distance « hexagonale » au centre
            float hd = max(max(abs(dot(p, vec2(0.5, 0.8660254))), abs(dot(p, vec2(1.0, 0.0)))), abs(dot(p, vec2(-0.5, 0.8660254))));
            float apothem = R * 0.8660254;
            float top = step(0.999, vLocal.y);
            float rim = smoothstep(apothem - W, apothem - W * 0.2, hd);
            float lip = (1.0 - top) * (1.0 - smoothstep(W * 0.5, W * 1.5, (1.0 - vLocal.y) * vH));
            float edge = max(top * rim, max(side * (1.0 - top), lip));
            float t = abs(fract(vTint + uShift) * 2.0 - 1.0);
            vec3 neonC = mix(uC0, uC1, t);
            float level = 0.25 + 3.2 * vGlow;
            totalEmissiveRadiance += neonC * edge * level;
            // halo intérieur : le dessus et le haut des flancs s'allument sur les pics
            totalEmissiveRadiance += neonC * vGlow * (top * 0.18 + (1.0 - top) * 0.35 * pow(vLocal.y, 4.0));
          }`,
        );
    };
  }
}

/** Spectre interpolé à la position bp (0..last). */
function sample(spec: Float32Array, bp: number, last: number): number {
  const b0 = Math.floor(bp);
  const b1 = Math.min(last, b0 + 1);
  return spec[b0] + (spec[b1] - spec[b0]) * (bp - b0);
}

function fract(x: number): number {
  return x - Math.floor(x);
}
