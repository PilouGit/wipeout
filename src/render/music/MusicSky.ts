import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from 'three';
import { follow, type MusicBands } from './MusicBands';
import type { Staging } from './Staging';

/** Nombre de nuées de plasma qui dérivent dans le ciel. */
const PLASMA_COUNT = 4;

const VERTEX = /* glsl */ `
  varying vec3 vP;
  void main() { vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const FRAGMENT = /* glsl */ `
  uniform vec3 fogc;
  uniform vec3 horizon;
  uniform vec3 mid;
  uniform vec3 top;
  uniform vec3 accent;
  /** Rotation de teinte (rad) : section musicale + note de basse. */
  uniform float hue;
  /** Éclair à l'horizon sur les kicks. */
  uniform float flash;
  /** Ruban d'aurore : intensité (médiums) et phase (tempo). */
  uniform float aurora;
  uniform float beat;
  /** Luminosité globale (densité d'orchestration). */
  uniform float glow;
  /** Nuages : dérive accumulée, couverture (nappes), turbulence (médiums), éclat (graves), liseré (aigus). */
  uniform vec2 cloudDrift;
  uniform float cloudCover;
  uniform float cloudWarp;
  uniform float cloudLight;
  uniform float cloudEdge;
  uniform vec3 cloudColor;
  /** Plasma : direction, couleur et intensité de chaque nuée, phase des filaments. */
  uniform vec3 plasmaDir[${PLASMA_COUNT}];
  uniform vec3 plasmaCol[${PLASMA_COUNT}];
  uniform float plasmaAmp[${PLASMA_COUNT}];
  uniform float plasmaTime;
  varying vec3 vP;

  vec3 hueShift(vec3 c, float a) {
    const vec3 k = vec3(0.57735);
    float ca = cos(a);
    return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
  }
  // hachage sans sinus (stable en précision sur de grandes coordonnées)
  float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  /** Bruit à deux octaves : suffit pour déformer les nuages, pour un tiers du coût. */
  float fbm2(vec2 p) { return 0.667 * noise(p) + 0.333 * noise(p * 2.03 + vec2(17.1, 9.2)); }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < OCTAVES; i++) { v += a * noise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
    return v;
  }

  void main() {
    float h = vP.y;
    vec3 c = mix(fogc, horizon, smoothstep(-0.01, 0.03, h));
    c = mix(c, mid, smoothstep(0.03, 0.22, h));
    c = mix(c, top, smoothstep(0.22, 0.7, h));
    // au ras de l'horizon, le ciel garde la couleur du brouillard (raccord avec le décor)
    float above = smoothstep(0.0, 0.12, h);
    c = mix(c, max(hueShift(c, hue), 0.0), above);
    c *= mix(1.0, 0.8 + 0.45 * glow, above);
    c += horizon * flash * (1.0 - smoothstep(0.0, 0.3, h)) * step(-0.01, h);
    float az = atan(vP.z, vP.x);

    // plasma : nuées colorées aux filaments ondulants, qui dérivent au gré de leur bande
    float filaments = sin(vP.x * 9.0 + plasmaTime) + sin(vP.y * 13.0 - plasmaTime * 1.3)
      + sin((vP.x + vP.z) * 7.0 + plasmaTime * 0.7) + sin(length(vP.xz) * 15.0 - plasmaTime * 1.1);
    filaments = 0.5 + 0.5 * sin(filaments * 1.5708);
    vec3 plasma = vec3(0.0);
    for (int i = 0; i < ${PLASMA_COUNT}; i++) {
      vec3 d = vP - plasmaDir[i];
      float size = 0.05 + 0.07 * plasmaAmp[i];
      float core = exp(-dot(d, d) / size);
      plasma += plasmaCol[i] * core * (0.3 + 0.7 * filaments) * plasmaAmp[i];
    }
    c += max(hueShift(plasma, hue * 0.6), 0.0) * above;

    // nuages : plan virtuel au-dessus de la caméra, déformé par les médiums, poussé par le tempo
    // (calculés seulement au-dessus de l'horizon : le bruit est la partie la plus coûteuse du ciel)
    float fade = smoothstep(0.02, 0.18, h) * (1.0 - smoothstep(0.55, 0.95, h) * 0.5);
    if (fade > 0.001) {
      vec2 uv = vP.xz / (h + 0.18) * 1.6;
      vec2 warp = vec2(fbm2(uv * 0.7 + cloudDrift * 0.5), fbm2(uv * 0.7 - cloudDrift.yx * 0.5 + 4.3));
      float n = fbm(uv + cloudDrift + (warp - 0.5) * (0.6 + 2.2 * cloudWarp));
      float cover = smoothstep(0.62 - 0.3 * cloudCover, 0.9, n);
      float edge = smoothstep(0.0, 0.25, cover) * (1.0 - smoothstep(0.25, 0.7, cover));
      vec3 cloud = mix(mid * 0.5, max(hueShift(cloudColor, hue), 0.0), 0.35 + 0.65 * cloudLight);
      c = mix(c, cloud * (0.6 + 1.4 * cloudLight), cover * fade * 0.8);
      c += max(hueShift(accent, hue * 0.5), 0.0) * edge * fade * cloudEdge * 0.9;
      // les nuées de plasma éclairent les nuages par en dessous
      c += plasma * cover * fade * 0.8;
    }

    float y0 = 0.16 + 0.05 * sin(az * 5.0 + beat * 1.5708) + 0.03 * sin(az * 11.0 - beat * 0.785);
    float band = exp(-pow((h - y0) / 0.035, 2.0)) * (0.6 + 0.4 * sin(az * 23.0 + beat * 3.1416));
    c += max(hueShift(accent, hue * 0.5), 0.0) * band * aurora;
    if (h < -0.01) c = fogc;
    gl_FragColor = vec4(c, 1.0);
  }`;

/** Teinte du ciel par section du thème (chunk iMUSE → rotation de teinte en radians). */
const SECTION_HUE: Readonly<Record<number, number>> = {
  0: 0, 1: 0.25, 2: 0, 3: 0.45, 4: 0.45, 5: -1.0, 6: 1.9, 7: 1.9, 8: 0,
};

/** Bandes du spectre (MusicBands.spectrumNorm) suivies par chaque nuée : kick+basse, caisse claire, mélodie, nappe+charleston. */
const PLASMA_BANDS: readonly (readonly number[])[] = [[0, 1], [2], [4], [3, 5]];

export interface SkyColors {
  readonly fog: number;
  readonly sky: readonly [number, number, number];
  readonly accent: number;
  /** Couleurs des nuées de plasma. */
  readonly plasma: readonly number[];
  readonly cloud: number;
}

interface Plasma {
  azimuth: number;
  elevation: number;
  phase: number;
  spin: number;
  amp: number;
}

/**
 * Dôme céleste musical : dégradé teinté selon la section, éclairs, aurore, nuages qui dérivent
 * au rythme et nuées de plasma colorées pilotées chacune par une bande du spectre.
 */
export class MusicSky {
  readonly mesh: Mesh;
  private readonly u: Record<string, { value: any }>;
  private readonly plasmas: Plasma[] = [];
  private hue = 0;
  private drift = 0;
  private plasmaTime = 0;
  private cloudLight = 0;
  private readonly octaves: number;

  constructor(colors: SkyColors, lite: boolean) {
    this.octaves = lite ? 3 : 5;
    const col = (hex: number, k = 1) => new Color(hex).multiplyScalar(k);
    for (let i = 0; i < PLASMA_COUNT; i++) {
      this.plasmas.push({ azimuth: (i / PLASMA_COUNT) * Math.PI * 2 + 0.4, elevation: 0.3, phase: i * 1.7, spin: i % 2 ? -1 : 1, amp: 0 });
    }
    this.u = {
      fogc: { value: col(colors.fog) }, horizon: { value: col(colors.sky[0]) }, mid: { value: col(colors.sky[1]) }, top: { value: col(colors.sky[2]) },
      accent: { value: col(colors.accent, 1.6) }, hue: { value: 0 }, flash: { value: 0 }, aurora: { value: 0 }, beat: { value: 0 }, glow: { value: 0.4 },
      cloudDrift: { value: [0, 0] }, cloudCover: { value: 0.3 }, cloudWarp: { value: 0 }, cloudLight: { value: 0 }, cloudEdge: { value: 0 },
      cloudColor: { value: col(colors.cloud, 1.2) },
      plasmaDir: { value: this.plasmas.map(() => new Vector3(0, 1, 0)) },
      plasmaCol: { value: this.plasmas.map((_, i) => col(colors.plasma[i % colors.plasma.length], 1.5)) },
      plasmaAmp: { value: new Array(PLASMA_COUNT).fill(0) },
      plasmaTime: { value: 0 },
    };
    this.mesh = new Mesh(
      new SphereGeometry(5000, 48, 24),
      new ShaderMaterial({
        side: BackSide, depthWrite: false, uniforms: this.u,
        defines: { OCTAVES: this.octaves },
        vertexShader: VERTEX, fragmentShader: FRAGMENT,
      }),
    );
    this.mesh.renderOrder = -10;
  }

  /** Ciel allégé : moins d'octaves de bruit pour les nuages (recompile le shader). */
  setLight(light: boolean): void {
    const mat = this.mesh.material as ShaderMaterial;
    const octaves = light ? 3 : this.octaves;
    if (mat.defines.OCTAVES === octaves) return;
    mat.defines.OCTAVES = octaves;
    mat.needsUpdate = true;
  }

  update(dt: number, b: MusicBands, stage: Staging): void {
    const f = b.features;
    const u = this.u;
    const n = b.spectrumNorm;
    const playing = f.clock ? 1 : 0;
    const bps = f.clock?.beatsPerSecond ?? 1;
    const section = f.clock ? SECTION_HUE[f.clock.chunk] ?? 0 : 0;
    const note = f.clock ? ((((f.bassNote % 12) + 12) % 12) / 12) * 0.5 : 0;
    // coupe : la palette de la nouvelle section s'impose net (la note de basse continue de glisser)
    if (stage.cutNow) this.hue = section + note;
    this.hue += (section + note - this.hue) * (1 - Math.exp(-dt * 0.9));
    u.hue.value = this.hue;
    // dynamique de la scène : un breakdown sombre et immobile, une montée qui retient tout, un drop éclatant
    const k = stage.intensity;
    const calm = 0.25 + 0.75 * k;
    u.flash.value = Math.min(1.6, (f.env.kick * 0.35 + f.env.impact * 1.2) * calm + stage.cut * 1.3);
    u.aurora.value = (b.mid * 0.9 + b.high * 0.3) * calm;
    u.beat.value = f.beats;
    u.glow.value = (0.3 + b.energy) * (0.45 + 0.55 * k) + stage.cut * 0.5;

    // nuages : dérive au tempo (plus vite quand l'orchestration est dense), relancée par les kicks
    this.drift += dt * (0.015 + playing * (0.025 * bps * (0.4 + b.energy) + 0.09 * b.bassN));
    u.cloudDrift.value = [this.drift, this.drift * 0.37];
    u.cloudCover.value = follow(u.cloudCover.value, 0.25 + 0.55 * n[3] + 0.25 * b.energy, dt, 1.5, 0.6);
    u.cloudWarp.value = follow(u.cloudWarp.value, b.midN, dt, 6, 1.5);
    this.cloudLight = follow(this.cloudLight, b.bassN * k, dt, 25, 3);
    u.cloudLight.value = this.cloudLight + stage.cut * 0.6;
    u.cloudEdge.value = follow(u.cloudEdge.value, b.highN * k, dt, 30, 5);

    // plasma : chaque nuée tourne autour de l'horizon, monte et grossit avec sa bande
    this.plasmaTime += dt * (0.4 + 1.6 * b.energy + 0.8 * b.highN);
    u.plasmaTime.value = this.plasmaTime;
    this.plasmas.forEach((p, i) => {
      const level = Math.max(...PLASMA_BANDS[i].map((k) => n[k])) * playing;
      p.amp = follow(p.amp, (0.12 + 0.88 * level) * calm + stage.cut * 0.5, dt, 12, 1.8);
      p.azimuth += dt * p.spin * (0.03 + 0.35 * level * bps * 0.5);
      const el = 0.2 + 0.14 * Math.sin(p.phase + f.beats * 0.0625 * Math.PI) + 0.1 * p.amp;
      p.elevation = follow(p.elevation, el, dt, 2, 2);
      const r = Math.sqrt(1 - p.elevation * p.elevation);
      (u.plasmaDir.value[i] as Vector3).set(Math.cos(p.azimuth) * r, p.elevation, Math.sin(p.azimuth) * r);
      u.plasmaAmp.value[i] = p.amp;
    });
  }
}
