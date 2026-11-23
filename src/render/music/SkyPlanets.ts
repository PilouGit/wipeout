import { AdditiveBlending, BackSide, Color, DoubleSide, Group, Mesh, RingGeometry, ShaderMaterial, SphereGeometry, Vector3 } from 'three';
import { follow, type MusicBands } from './MusicBands';
import type { Staging } from './Staging';

/** Bande musicale qui fait vibrer un astre. */
export type PlanetBand = 'bass' | 'mid' | 'high';

export interface PlanetSpec {
  /** Position dans le ciel (le groupe suit la caméra). */
  readonly at: readonly [number, number, number];
  readonly radius: number;
  /** Couleurs des bandes nuageuses ; la première éclaire aussi l'atmosphère. */
  readonly colors: readonly [number, number];
  readonly band: PlanetBand;
  /** Anneaux : inclinaison (rad), ou absent. */
  readonly ring?: number;
}

const PLANET_VERTEX = /* glsl */ `
  uniform float uAmp;
  uniform float uBeat;
  uniform float uR;
  varying vec3 vLocal;
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    vec3 p = position;
    // surface qui vibre : ondes stationnaires en latitude × longitude, au tempo
    float lon = atan(p.z, p.x);
    float wob = sin(p.y / uR * 7.0 + uBeat * 3.14159) * sin(lon * 4.0 - uBeat * 1.5708);
    p += normal * wob * uAmp * uR * 0.07;
    vLocal = position / uR;
    vN = normal;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vView = normalize(cameraPosition - (modelMatrix * vec4(p, 1.0)).xyz);
    gl_Position = projectionMatrix * mv;
  }`;

const PLANET_FRAGMENT = /* glsl */ `
  uniform vec3 uA;
  uniform vec3 uB;
  uniform vec3 uLight;
  uniform float uSpin;
  uniform float uGlow;
  uniform float uPulse;
  varying vec3 vLocal;
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    vec3 n = normalize(vN);
    float lon = atan(vLocal.z, vLocal.x) + uSpin;
    float t = vLocal.y * 6.0 + sin(lon * 3.0 + vLocal.y * 4.0) * 0.5 + sin(lon * 7.0) * 0.15;
    float stripe = 0.5 + 0.5 * sin(t * 3.14159);
    vec3 base = mix(uA, uB, stripe);
    float shade = 0.25 + 0.75 * max(dot(n, uLight), 0.0);
    float rim = pow(1.0 - max(dot(n, normalize(vView)), 0.0), 3.0);
    // les bandes s'illuminent sur les temps forts de leur bande musicale
    float lines = pow(1.0 - abs(stripe * 2.0 - 1.0), 6.0);
    vec3 c = base * shade + uA * rim * (0.6 + 2.5 * uGlow) + uA * lines * uPulse * 1.4;
    gl_FragColor = vec4(c, 1.0);
  }`;

const HALO_FRAGMENT = /* glsl */ `
  uniform vec3 uA;
  uniform float uGlow;
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    // face arrière de la coquille : max juste au-delà du limbe de la planète, nul au bord de la coquille
    float f = pow(clamp(-dot(normalize(vN), normalize(vView)) * 1.6, 0.0, 1.0), 2.0);
    gl_FragColor = vec4(uA * f * (0.25 + 1.2 * uGlow), 1.0);
  }`;

const RING_VERTEX = /* glsl */ `
  uniform float uAmp;
  uniform float uBeat;
  uniform float uR;
  varying float vR;
  void main() {
    vec3 p = position;
    vR = length(p.xy) / uR;
    // l'anneau ondule comme une membrane de haut-parleur
    p.z += sin(vR * 18.0 - uBeat * 6.2832) * uAmp * uR * 0.05;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;

const RING_FRAGMENT = /* glsl */ `
  uniform vec3 uA;
  uniform vec3 uB;
  uniform float uGlow;
  /** Rayon (0..1 sur la largeur de l'anneau) du front de l'onde de kick. */
  uniform float uWave;
  uniform float uWaveAmp;
  varying float vR;
  void main() {
    float r = (vR - 1.4) / 0.9;
    float bands = 0.55 + 0.45 * sin(r * 70.0) * sin(r * 23.0 + 1.3);
    float gap = smoothstep(0.38, 0.42, r) * (1.0 - smoothstep(0.46, 0.5, r));
    float a = bands * (1.0 - gap) * smoothstep(0.0, 0.05, r) * (1.0 - smoothstep(0.9, 1.0, r));
    float wave = exp(-pow((r - uWave) / 0.06, 2.0)) * uWaveAmp;
    vec3 c = mix(uB, uA, r) * (0.35 + 0.9 * uGlow) + uA * wave * 2.5;
    gl_FragColor = vec4(c * a, 1.0);
  }`;

interface Planet {
  readonly spec: PlanetSpec;
  readonly body: Mesh;
  readonly halo: Mesh;
  readonly ring: Mesh | null;
  readonly u: Record<string, { value: any }>;
  readonly ringU: Record<string, { value: any }> | null;
  level: number;
  spin: number;
}

/**
 * Planètes lointaines qui vibrent avec la musique : chacune écoute une bande (graves, médiums
 * ou aigus) — sa surface ondule, son atmosphère pulse, ses bandes s'allument, et ses anneaux
 * propagent les ondes de kick comme une membrane.
 */
export class SkyPlanets {
  readonly root = new Group();
  private readonly planets: Planet[] = [];

  constructor(specs: readonly PlanetSpec[], sunDirection: Vector3) {
    const light = sunDirection.clone().normalize();
    for (const spec of specs) {
      const R = spec.radius;
      const a = new Color(spec.colors[0]);
      const b = new Color(spec.colors[1]);
      const u = {
        uA: { value: a }, uB: { value: b }, uLight: { value: light }, uSpin: { value: Math.random() * 6 },
        uGlow: { value: 0 }, uPulse: { value: 0 }, uAmp: { value: 0 }, uBeat: { value: 0 }, uR: { value: R },
      };
      const body = new Mesh(new SphereGeometry(R, 64, 32), new ShaderMaterial({ uniforms: u, vertexShader: PLANET_VERTEX, fragmentShader: PLANET_FRAGMENT }));
      const halo = new Mesh(
        new SphereGeometry(R * 1.18, 48, 24),
        new ShaderMaterial({
          uniforms: { uA: { value: a.clone().multiplyScalar(1.6) }, uGlow: u.uGlow, uAmp: { value: 0 }, uBeat: u.uBeat, uR: u.uR },
          vertexShader: PLANET_VERTEX, fragmentShader: HALO_FRAGMENT,
          side: BackSide, transparent: true, blending: AdditiveBlending, depthWrite: false,
        }),
      );
      body.position.set(...spec.at);
      halo.position.copy(body.position);
      body.renderOrder = halo.renderOrder = -8;
      this.root.add(body, halo);

      let ring: Mesh | null = null;
      let ringU: Planet['ringU'] = null;
      if (spec.ring !== undefined) {
        ringU = { uA: { value: a.clone().multiplyScalar(1.3) }, uB: { value: b }, uGlow: u.uGlow, uWave: { value: 2 }, uWaveAmp: { value: 0 }, uAmp: { value: 0 }, uBeat: u.uBeat, uR: u.uR };
        ring = new Mesh(
          new RingGeometry(R * 1.4, R * 2.3, 128, 6),
          new ShaderMaterial({
            uniforms: ringU, vertexShader: RING_VERTEX, fragmentShader: RING_FRAGMENT,
            side: DoubleSide, transparent: true, blending: AdditiveBlending, depthWrite: false,
          }),
        );
        ring.position.copy(body.position);
        // le plan de l'anneau fait face à la caméra puis bascule
        ring.lookAt(0, 0, 0);
        ring.rotateX(spec.ring);
        ring.renderOrder = -7;
        this.root.add(ring);
      }
      this.planets.push({ spec, body, halo, ring, u, ringU, level: 0, spin: 0 });
    }
  }

  /** Atmosphères (coquilles additives) visibles ou non. */
  set halos(on: boolean) {
    for (const p of this.planets) p.halo.visible = on;
  }

  update(dt: number, b: MusicBands, stage: Staging): void {
    const k = 0.2 + 0.8 * stage.intensity;
    const f = b.features;
    const age = f.waveAge[0] ?? 9;
    const strength = f.waveStrength[0] ?? 0;
    for (const p of this.planets) {
      const raw = p.spec.band === 'bass' ? b.bassN : p.spec.band === 'mid' ? b.midN : b.highN;
      p.level = follow(p.level, raw * k + stage.cut * 0.6, dt, 30, 4);
      p.spin += dt * (0.02 + 0.08 * b.energy);
      const u = p.u;
      u.uSpin.value = p.spin;
      u.uBeat.value = f.beats;
      u.uAmp.value = p.level;
      u.uGlow.value = 0.15 + 0.85 * p.level;
      u.uPulse.value = p.level * p.level;
      // l'astre enfle sur sa bande et l'atmosphère respire
      p.body.scale.setScalar(1 + 0.06 * p.level);
      p.halo.scale.setScalar(1 + 0.18 * p.level);
      if (p.ring && p.ringU) {
        p.ringU.uAmp.value = b.midN * 0.8 + p.level * 0.4;
        // l'onde du dernier kick traverse l'anneau de l'intérieur vers l'extérieur en ~0,6 s
        p.ringU.uWave.value = age / 0.6;
        p.ringU.uWaveAmp.value = strength * Math.exp(-age * 2.5);
      }
    }
  }
}
