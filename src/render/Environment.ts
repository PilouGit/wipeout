import {
  BackSide, BoxGeometry, Color, ConeGeometry, DoubleSide, RepeatWrapping, Path, Shape, ShapeGeometry, Vector2, CylinderGeometry, Float32BufferAttribute, BufferGeometry, GridHelper,
  Group, IcosahedronGeometry, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry,
  Points, PointsMaterial, ShaderMaterial, SphereGeometry, TorusGeometry, Vector3,
} from 'three';
import { GROUND_Y } from '../config';
import { TUNNEL_CEILING, TUNNEL_WALL_MARGIN } from '../track/features';
import type { CircuitTheme } from '../track/circuits';
import type { Track } from '../track/Track';
import { neon, type Textures } from './textures';

const SKY_VERTEX = /* glsl */ `
  varying vec3 vP;
  void main() { vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const SKY_FRAGMENT = /* glsl */ `
  uniform vec3 fogc;
  uniform vec3 horizon;
  uniform vec3 mid;
  uniform vec3 top;
  varying vec3 vP;
  void main() {
    float h = vP.y;
    vec3 c = mix(fogc, horizon, smoothstep(-0.01, 0.03, h));
    c = mix(c, mid, smoothstep(0.03, 0.22, h));
    c = mix(c, top, smoothstep(0.22, 0.7, h));
    if (h < -0.01) c = fogc;
    gl_FragColor = vec4(c, 1.0);
  }`;

const SUN_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const SUN_FRAGMENT = /* glsl */ `
  uniform vec3 low;
  uniform vec3 high;
  uniform float stripes;
  varying vec2 vUv;
  void main() {
    if (length(vUv - 0.5) > 0.5) discard;
    float y = vUv.y;
    if (stripes > 0.5 && y < 0.48) {
      float gap = mix(0.5, 0.05, y / 0.48);
      if (fract(y * 16.0) < gap) discard;
    }
    gl_FragColor = vec4(mix(low, high, smoothstep(0.1, 0.9, y)), 1.0);
  }`;

const hdr = (hex: number, k: number) => new Color(hex).multiplyScalar(k);
const linear = (hex: number) => new Color(hex);

/** Décor d'un circuit : ciel, sol, paysage et reliefs couvrant les tunnels. */
export class Environment {
  /** Décor fixe. */
  readonly root = new Group();
  /** Éléments à l'infini : suivent la caméra. */
  readonly sky = new Group();

  constructor(private readonly track: Track, tex: Textures, private readonly theme: CircuitTheme) {
    this.buildSky();
    this.buildGround();
    switch (theme.scenery) {
      case 'city':
        this.buildCity(tex);
        break;
      case 'peaks':
        this.buildPeaks(0xcfe6ff, 0x5a7aa8, true);
        break;
      case 'volcano':
        this.buildPeaks(0x2a1410, 0x140806, false);
        this.buildVolcano();
        break;
      case 'moon':
        this.buildMoon();
        break;
    }
    this.coverTunnels(tex);
  }

  follow(cameraPosition: Vector3): void {
    this.sky.position.copy(cameraPosition);
  }

  set visible(v: boolean) {
    this.root.visible = this.sky.visible = v;
  }

  // ------------------------------------------------------------------ ciel et sol

  private buildSky(): void {
    const t = this.theme;
    const sky = new Mesh(
      new SphereGeometry(5000, 32, 16),
      new ShaderMaterial({
        side: BackSide, depthWrite: false,
        uniforms: { fogc: { value: linear(t.fog) }, horizon: { value: linear(t.sky[0]) }, mid: { value: linear(t.sky[1]) }, top: { value: linear(t.sky[2]) } },
        vertexShader: SKY_VERTEX, fragmentShader: SKY_FRAGMENT,
      }),
    );
    sky.renderOrder = -10;

    const moon = t.scenery === 'moon';
    const sun = new Mesh(
      new PlaneGeometry(moon ? 900 : 1400, moon ? 900 : 1400),
      new ShaderMaterial({
        transparent: true, depthWrite: false,
        uniforms: { low: { value: hdr(t.sun[0], 1.6) }, high: { value: hdr(t.sun[1], 1.8) }, stripes: { value: t.scenery === 'city' ? 1 : 0 } },
        vertexShader: SUN_VERTEX, fragmentShader: SUN_FRAGMENT,
      }),
    );
    sun.position.set(400, moon ? 1400 : 260, -4300);
    sun.lookAt(0, 0, 0);
    sun.renderOrder = -9;

    const pts: number[] = [];
    const count = moon ? 4000 : 1800;
    for (let i = 0; i < count; i++) {
      const th = Math.random() * Math.PI * 2;
      const y = 0.08 + Math.random() * 0.92;
      const r = Math.sqrt(1 - y * y);
      pts.push(Math.cos(th) * r * 4500, y * 4500, Math.sin(th) * r * 4500);
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pts, 3));
    const stars = new Points(geo, new PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: t.scenery === 'peaks' ? 0.35 : 0.8 }));
    stars.renderOrder = -9;
    this.sky.add(sky, sun, stars);

    if (moon) {
      // la Terre, au-dessus de l'horizon
      const earth = new Mesh(new SphereGeometry(260, 32, 16), new MeshBasicMaterial({ color: hdr(0x3a7bff, 1.1), fog: false }));
      earth.position.set(-1600, 900, -3600);
      const halo = new Mesh(new SphereGeometry(275, 32, 16), new MeshBasicMaterial({ color: hdr(0x9ad7ff, 0.6), transparent: true, opacity: 0.25, fog: false, side: BackSide }));
      halo.position.copy(earth.position);
      this.sky.add(earth, halo);
    }
  }

  private buildGround(): void {
    const t = this.theme;
    const ground = new Mesh(new PlaneGeometry(12000, 12000), new MeshBasicMaterial({ color: t.ground }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = GROUND_Y - 0.2;
    const grid = new GridHelper(12000, 240, neon(t.grid[0], 0.9), neon(t.grid[1], 0.7));
    grid.position.y = GROUND_Y;
    this.root.add(ground, grid);
  }

  // ------------------------------------------------------------------ paysages

  /** Tire des emplacements à distance de la piste. */
  private scatter(count: number, size: (k: number) => number, extent = 1.0): [number, number, number][] {
    const pts = this.track.points;
    const xs = pts.map((p) => p.x);
    const zs = pts.map((p) => p.z);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) * 1.6 * extent + 1200;
    const out: [number, number, number][] = [];
    for (let tries = 0; out.length < count && tries < count * 25; tries++) {
      const x = cx + (Math.random() - 0.5) * span;
      const z = cz + (Math.random() - 0.5) * span;
      const s = size(out.length);
      const clearance = (45 + s) ** 2;
      let ok = true;
      for (let i = 0; i < pts.length && ok; i += 4) {
        const dx = pts[i].x - x;
        const dz = pts[i].z - z;
        ok = dx * dx + dz * dz >= clearance;
      }
      if (ok) out.push([x, z, s]);
    }
    return out;
  }

  private buildCity(tex: Textures): void {
    const sizes: number[] = [];
    const spots = this.scatter(260, (k) => (sizes[k] = 14 + Math.random() * 30), 0.9);
    const geo = new BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const mat = new MeshStandardMaterial({ color: 0x9090b0, map: tex.windows, emissive: 0xffffff, emissiveMap: tex.windows, emissiveIntensity: 1.3, roughness: 0.6, metalness: 0.3 });
    const bodies = new InstancedMesh(geo, mat, spots.length);
    const caps = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ color: 0xffffff }), spots.length);
    const palette = [0xff3fb4, 0x2ef2ff, 0xffd34d, 0x9a7bff];
    const m = new Matrix4();
    spots.forEach(([x, z, w], k) => {
      const d = 14 + Math.random() * 30;
      const h = 30 + Math.random() * 150;
      bodies.setMatrixAt(k, m.makeScale(w, h, d).setPosition(x, GROUND_Y, z));
      caps.setMatrixAt(k, m.makeScale(w + 0.6, 0.8, d + 0.6).setPosition(x, GROUND_Y + h, z));
      caps.setColorAt(k, neon(palette[k % palette.length], 3));
    });
    this.root.add(bodies, caps);
  }

  /** Massifs coniques ; `snow` ajoute des sommets enneigés. */
  private buildPeaks(rock: number, base: number, snow: boolean): void {
    const spots = this.scatter(140, () => 60 + Math.random() * 160, 1.3);
    const cone = new ConeGeometry(1, 1, 7, 1);
    cone.translate(0, 0.5, 0);
    const bodies = new InstancedMesh(cone, new MeshStandardMaterial({ color: base, roughness: 0.95, flatShading: true }), spots.length);
    const tops = new InstancedMesh(cone, new MeshStandardMaterial({ color: rock, roughness: 0.6, flatShading: true, emissive: snow ? 0x223355 : 0x000000 }), spots.length);
    const m = new Matrix4();
    spots.forEach(([x, z, r], k) => {
      const h = r * (1.2 + Math.random() * 1.4);
      bodies.setMatrixAt(k, m.makeScale(r, h, r).setPosition(x, GROUND_Y, z));
      // le sommet : un cône semblable, plus petit, qui coiffe le premier
      const f = snow ? 0.38 : 0.2;
      tops.setMatrixAt(k, m.makeScale(r * f * 1.04, h * f, r * f * 1.04).setPosition(x, GROUND_Y + h * (1 - f) + 0.5, z));
    });
    this.root.add(bodies, tops);
  }

  private buildVolcano(): void {
    const g = new Group();
    const body = new Mesh(new CylinderGeometry(220, 900, 620, 12, 1, true), new MeshStandardMaterial({ color: 0x1a0a06, roughness: 1, flatShading: true }));
    body.position.y = GROUND_Y + 310;
    const crater = new Mesh(new CylinderGeometry(200, 200, 8, 24), new MeshBasicMaterial({ color: hdr(0xff5a1f, 3) }));
    crater.position.y = GROUND_Y + 615;
    const plume = new Mesh(new SphereGeometry(260, 16, 10), new MeshBasicMaterial({ color: hdr(0xff3a1f, 0.5), transparent: true, opacity: 0.35, depthWrite: false }));
    plume.position.y = GROUND_Y + 760;
    plume.scale.set(1, 0.5, 1);
    g.add(body, crater, plume);
    g.position.set(1500, 0, -1900);
    // coulées de lave au sol
    const lava = new MeshBasicMaterial({ color: hdr(0xff4a12, 2.2) });
    for (let i = 0; i < 9; i++) {
      const river = new Mesh(new PlaneGeometry(30 + Math.random() * 40, 900 + Math.random() * 900), lava);
      river.rotation.x = -Math.PI / 2;
      river.rotation.z = Math.random() * Math.PI;
      const a = Math.random() * Math.PI * 2;
      river.position.set(1500 + Math.cos(a) * 1300, GROUND_Y + 0.3, -1900 + Math.sin(a) * 1300);
      this.root.add(river);
    }
    this.root.add(g);
  }

  private buildMoon(): void {
    // cratères
    const spots = this.scatter(90, () => 40 + Math.random() * 140, 1.4);
    const ring = new TorusGeometry(1, 0.18, 6, 28);
    ring.rotateX(Math.PI / 2);
    const craters = new InstancedMesh(ring, new MeshStandardMaterial({ color: 0x3a3a44, roughness: 1, flatShading: true }), spots.length);
    const m = new Matrix4();
    spots.forEach(([x, z, r], k) => craters.setMatrixAt(k, m.makeScale(r, r * 0.6, r).setPosition(x, GROUND_Y, z)));
    // dômes de la base, cerclés de néon
    const domes = this.scatter(26, () => 20 + Math.random() * 40, 0.6);
    const dome = new SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    const domeMesh = new InstancedMesh(dome, new MeshStandardMaterial({ color: 0xd8dce8, metalness: 0.6, roughness: 0.3, emissive: 0x112233 }), domes.length);
    const neonRing = new TorusGeometry(1.02, 0.03, 6, 40);
    neonRing.rotateX(Math.PI / 2);
    const rings = new InstancedMesh(neonRing, new MeshBasicMaterial({ color: neon(this.theme.accent, 2.5) }), domes.length);
    domes.forEach(([x, z, r], k) => {
      domeMesh.setMatrixAt(k, m.makeScale(r, r * 0.8, r).setPosition(x, GROUND_Y, z));
      rings.setMatrixAt(k, m.makeScale(r, r, r).setPosition(x, GROUND_Y + 1, z));
    });
    // rochers épars
    const rocks = this.scatter(160, () => 4 + Math.random() * 14, 1.2);
    const rockMesh = new InstancedMesh(new IcosahedronGeometry(1, 0), new MeshStandardMaterial({ color: 0x55555f, flatShading: true }), rocks.length);
    rocks.forEach(([x, z, r], k) => rockMesh.setMatrixAt(k, m.makeScale(r, r * 0.7, r * 1.2).setPosition(x, GROUND_Y + r * 0.2, z)));
    this.root.add(craters, domeMesh, rings, rockMesh);
  }

  /**
   * Habille chaque tunnel : une enveloppe creuse (colline ou immeuble-pont) extrudée le long du tube,
   * qui ne pénètre jamais l'intérieur, et une façade percée à chaque entrée.
   * (Des volumes pleins posés sur le tunnel le traversaient : leurs faces apparaissaient en blocs noirs.)
   */
  private coverTunnels(tex: Textures): void {
    const t = this.track;
    const city = this.theme.scenery === 'city';
    const mat = city
      ? (() => {
          // même façade éclairée que les tours, répétée sur toute la longueur
          const windows = tex.windows.clone();
          windows.wrapS = windows.wrapT = RepeatWrapping;
          windows.needsUpdate = true;
          return new MeshStandardMaterial({ color: 0x9090b0, map: windows, emissive: 0xffffff, emissiveMap: windows, emissiveIntensity: 1.3, roughness: 0.6, metalness: 0.3, side: DoubleSide });
        })()
      : new MeshStandardMaterial({ color: this.theme.scenery === 'peaks' ? 0x6f8fbf : this.theme.scenery === 'moon' ? 0x4a4a55 : 0x24100a, roughness: 0.95, flatShading: true, side: DoubleSide });
    // texture : une travée de fenêtres = 16 m de long × 64 m de haut
    const U = 16;
    const V = 64;
    // enveloppe (x, y) dans le repère de la piste, de gauche à droite, posée au sol de chaque côté
    const top: readonly (readonly [number, number])[] = city
      ? [[-34, 26], [-34, 34], [34, 34], [34, 26]]
      : [[-58, 10], [-36, 19], [-14, 24], [14, 24], [36, 19], [58, 10]];
    const outline = (i: number, k: number): [number, number][] => {
      const bottom = Math.min(-1.5, GROUND_Y - t.points[i].y);
      const wobble = city ? 1 : 1 + 0.12 * Math.sin(i * 0.11 + k * 1.7);
      return [[top[0][0], bottom], ...top.map(([x, y]) => [x, y * wobble] as [number, number]), [top[top.length - 1][0], bottom]];
    };
    let k = 0;
    for (const z of t.zones) {
      if (z.kind !== 'tunnel') continue;
      k++;
      const a = Math.round(z.from / t.spacing);
      const b = Math.round(z.to / t.spacing);
      const m = top.length + 2;
      const pos: number[] = [];
      const uv: number[] = [];
      const idx: number[] = [];
      const v = new Vector3();
      for (let i = a; i <= b; i++) {
        const j = i % t.count;
        let around = 0;
        let prev: [number, number] | null = null;
        for (const [x, y] of outline(j, k)) {
          if (prev) around += Math.hypot(x - prev[0], y - prev[1]);
          prev = [x, y];
          v.copy(t.points[j]).addScaledVector(t.rights[j], x).addScaledVector(t.ups[j], y);
          pos.push(v.x, v.y, v.z);
          uv.push(((i - a) * t.spacing) / U, around / V);
        }
        if (i < b) {
          const r = (i - a) * m;
          for (let c = 0; c < m - 1; c++) idx.push(r + c, r + c + 1, r + c + m, r + c + 1, r + c + m + 1, r + c + m);
        }
      }
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      this.root.add(new Mesh(g, mat));
      // façades : l'enveloppe percée du gabarit du tunnel
      for (const i of [a, b]) {
        const j = i % t.count;
        const face = new Shape(outline(j, k).map(([x, y]) => new Vector2(x, y)));
        const hw = t.halfWidth + TUNNEL_WALL_MARGIN + 0.4;
        const c = TUNNEL_CEILING + 0.4;
        face.holes.push(new Path([[hw, -1.2], [hw, 6], [hw - 4, c], [-hw + 4, c], [-hw, 6], [-hw, -1.2]].map(([x, y]) => new Vector2(x, y))));
        const geo = new ShapeGeometry(face);
        const p = geo.getAttribute('position');
        const uvs = geo.getAttribute('uv');
        for (let n = 0; n < p.count; n++) {
          uvs.setXY(n, p.getX(n) / U, p.getY(n) / V);
          v.copy(t.points[j]).addScaledVector(t.rights[j], p.getX(n)).addScaledVector(t.ups[j], p.getY(n));
          p.setXYZ(n, v.x, v.y, v.z);
        }
        geo.computeVertexNormals();
        this.root.add(new Mesh(geo, mat));
      }
    }
  }
}
