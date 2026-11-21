import {
  AdditiveBlending, BoxGeometry, CircleGeometry, Color, ConeGeometry, CylinderGeometry, Euler, ExtrudeGeometry, Group,
  Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Quaternion, Shape, SphereGeometry, Sprite,
  SpriteMaterial, Vector3, type Scene,
} from 'three';
import { HOVER_HEIGHT } from '../config';
import type { Ship } from '../race/Ship';
import type { HullStyle, Team } from '../race/teams';
import { createFrame, type Track } from '../track/Track';
import { neon, type Textures } from './textures';

const frame = createFrame();
const fwd = new Vector3();
const right = new Vector3();
const left = new Vector3();
const basis = new Matrix4();
const tilt = new Quaternion();
const euler = new Euler();

type XY = readonly [number, number];

/** Plan d'un engin. Repère : x vers la gauche/droite, y (du plan) vers l'avant. */
interface Design {
  /** Nez, puis demi-contour côté +x du nez vers l'arrière (symétrisé automatiquement). */
  readonly nose: number;
  readonly half: readonly XY[];
  readonly thick: number;
  /** Nacelles latérales (paires) : x, z du centre, largeur, hauteur, longueur. */
  readonly pods?: { x: number; z: number; w: number; h: number; l: number };
  /** Gros réacteurs cylindriques latéraux. */
  readonly nacelles?: { x: number; z: number; r: number; l: number };
  readonly fins?: { x: number; z: number; h: number; l: number; rake: number };
  readonly engines: readonly number[];
  readonly engineR: number;
  readonly cockpit: { z: number; scale: readonly [number, number, number] };
}

const DESIGNS: Readonly<Record<HullStyle, Design>> = {
  dart: {
    nose: 3.4, half: [[0.55, 1.6], [1.35, -0.9], [1.45, -1.9]], thick: 0.35,
    pods: { x: 1.2, z: -0.5, w: 0.55, h: 0.5, l: 2.6 }, fins: { x: 1.15, z: -1.3, h: 0.9, l: 1, rake: 0.18 },
    engines: [-0.6, 0.6], engineR: 0.3, cockpit: { z: 0.6, scale: [0.9, 0.6, 2] },
  },
  twinboom: {
    nose: 3.0, half: [[0.4, 2.0], [0.6, -0.6], [0.5, -1.6]], thick: 0.3,
    pods: { x: 1.7, z: 0.1, w: 0.42, h: 0.42, l: 4.4 }, fins: { x: 1.7, z: -1.6, h: 1.1, l: 0.9, rake: 0.1 },
    engines: [-1.7, 1.7], engineR: 0.24, cockpit: { z: 0.8, scale: [0.7, 0.55, 1.8] },
  },
  twinengine: {
    nose: 3.0, half: [[0.7, 1.8], [1.0, 0], [0.9, -1.9]], thick: 0.4,
    nacelles: { x: 1.35, z: -0.6, r: 0.5, l: 3.2 }, fins: { x: 0.6, z: -1.4, h: 0.8, l: 0.9, rake: 0.3 },
    engines: [-1.35, 1.35], engineR: 0.42, cockpit: { z: 0.9, scale: [0.9, 0.6, 1.7] },
  },
  brick: {
    nose: 2.7, half: [[1.2, 2.3], [1.75, 1.2], [1.85, -2.0]], thick: 0.7,
    fins: { x: 1.6, z: -1.3, h: 0.75, l: 1.4, rake: -0.1 },
    engines: [-1.3, -0.45, 0.45, 1.3], engineR: 0.26, cockpit: { z: 0.9, scale: [1.1, 0.7, 1.5] },
  },
  arrow: {
    nose: 3.9, half: [[0.4, 2.0], [1.9, -1.6], [1.0, -2.0]], thick: 0.32,
    fins: { x: 1.5, z: -1.3, h: 0.7, l: 0.8, rake: 0.35 },
    engines: [-0.5, 0.5], engineR: 0.3, cockpit: { z: 0.7, scale: [0.8, 0.55, 2.1] },
  },
  wedge: {
    nose: 3.0, half: [[1.1, 2.6], [1.7, -1.9]], thick: 0.55,
    pods: { x: 1.55, z: -0.4, w: 0.55, h: 0.65, l: 3.4 },
    engines: [-0.75, 0.75], engineR: 0.38, cockpit: { z: 0.5, scale: [1, 0.6, 1.8] },
  },
  mono: {
    nose: 3.6, half: [[0.5, 2.6], [0.95, 1.2], [1.05, -0.6], [0.8, -1.9]], thick: 0.45,
    fins: { x: 0.85, z: -1.4, h: 0.7, l: 1.0, rake: 0.25 },
    engines: [-0.42, 0.42], engineR: 0.3, cockpit: { z: 0.9, scale: [0.95, 0.75, 2.4] },
  },
  needle: {
    nose: 4.3, half: [[0.25, 2.4], [0.4, 0], [1.35, -1.4], [1.35, -1.8], [0.4, -1.9]], thick: 0.24,
    fins: { x: 1.35, z: -1.5, h: 0.6, l: 0.7, rake: 0 },
    engines: [0], engineR: 0.38, cockpit: { z: 1.0, scale: [0.55, 0.5, 2.2] },
  },
};

/** Modèle 3D d'un vaisseau (nez vers +Z, gauche vers +X) et sa pose à partir de l'état simulé. */
export class ShipView {
  readonly group = new Group();
  private model = new Group();
  private builtFor: Team | null = null;
  private flames: Mesh[] = [];
  private glow!: Sprite;
  private shield!: Mesh;

  constructor(scene: Scene, private readonly ship: Ship, private readonly tex: Textures) {
    this.group.add(this.model);
    this.group.visible = false;
    scene.add(this.group);
    this.refresh();
  }

  set visible(v: boolean) {
    this.group.visible = v;
  }

  /** Reconstruit le modèle si l'écurie du vaisseau a changé. */
  refresh(): void {
    const team = this.ship.team;
    if (team === this.builtFor) return;
    this.builtFor = team;
    this.group.remove(this.model);
    this.model.traverse((o) => {
      // (la géométrie des sprites est partagée par three.js : on n'y touche pas)
      if (o instanceof Mesh) o.geometry.dispose();
    });
    this.model = buildModel(team, this.tex);
    this.group.add(this.model);
    this.flames = this.model.userData.flames as Mesh[];
    this.glow = this.model.userData.glow as Sprite;
    this.shield = this.model.userData.shield as Mesh;
  }

  update(track: Track, time: number): void {
    const ship = this.ship;
    if (ship.dead) return;
    const f = track.frameAt(ship.s, frame);
    const cp = Math.cos(ship.psi);
    const sp = Math.sin(ship.psi);
    fwd.copy(f.t).multiplyScalar(cp).addScaledVector(f.r, sp);
    right.copy(f.r).multiplyScalar(cp).addScaledVector(f.t, -sp);
    left.copy(right).negate();

    const bob = Math.sin(time * 3 + ship.color) * 0.07;
    const g = this.group;
    g.position.copy(f.p).addScaledVector(f.r, ship.x).addScaledVector(f.u, HOVER_HEIGHT + bob);
    g.quaternion.setFromRotationMatrix(basis.makeBasis(left, f.u, fwd));

    const inp = ship.input;
    const roll = ship.steer * 0.38 + (inp.airbrakeRight - inp.airbrakeLeft) * 0.18;
    const pitch = -0.04 * inp.thrust + 0.05 * inp.brake;
    g.quaternion.multiply(tilt.setFromEuler(euler.set(pitch, ship.spin, roll)));

    const thrust = inp.thrust * 0.75 + (ship.boostTime > 0 ? 0.9 : 0) + 0.15;
    for (const flame of this.flames) flame.scale.set(1, 1, thrust * (0.85 + Math.random() * 0.3));
    this.glow.material.opacity = 0.4 + thrust * 0.4;
    this.shield.visible = ship.shielded && (ship.shieldTime > 1 || Math.floor(time * 10) % 2 === 0);
  }
}

function buildModel(team: Team, tex: Textures): Group {
  const d = DESIGNS[team.hull];
  const col = new Color(team.color);
  const body = new MeshStandardMaterial({ color: col.clone().lerp(new Color(0xffffff), 0.35), metalness: 0.55, roughness: 0.28 });
  const accent = new MeshStandardMaterial({ color: col, metalness: 0.4, roughness: 0.35, emissive: col, emissiveIntensity: 0.35 });
  const trim = new MeshStandardMaterial({ color: team.trim, metalness: 0.6, roughness: 0.3 });
  const dark = new MeshStandardMaterial({ color: 0x1b1b28, metalness: 0.8, roughness: 0.4 });
  const g = new Group();

  // coque : silhouette vue de dessus extrudée
  const outline = new Shape();
  outline.moveTo(0, d.nose);
  for (const [x, y] of d.half) outline.lineTo(x, y);
  for (const [x, y] of [...d.half].reverse()) outline.lineTo(-x, y);
  outline.closePath();
  const hull = new ExtrudeGeometry(outline, { depth: d.thick, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.12, bevelSegments: 2 });
  hull.rotateX(Math.PI / 2);
  hull.translate(0, d.thick, 0);
  g.add(new Mesh(hull, body));
  // liseré de couleur d'écurie sur le dessus
  const stripe = new Mesh(new BoxGeometry(0.22, 0.05, d.nose * 0.9), trim);
  stripe.position.set(0, d.thick + 0.14, d.nose * 0.3);
  g.add(stripe);

  const cockpit = new Mesh(
    new SphereGeometry(0.5, 18, 12),
    new MeshStandardMaterial({ color: 0x0a0a18, metalness: 0.9, roughness: 0.08, emissive: col, emissiveIntensity: 0.15 }),
  );
  cockpit.scale.set(...d.cockpit.scale);
  cockpit.position.set(0, d.thick + 0.15, d.cockpit.z);
  g.add(cockpit);

  const tail = Math.min(...d.half.map(([, y]) => y));
  let engineZ = tail - 0.05;
  for (const sx of [-1, 1]) {
    if (d.pods) {
      const p = d.pods;
      const pod = new Mesh(new BoxGeometry(p.w, p.h, p.l), accent);
      pod.position.set(sx * p.x, p.h / 2, p.z);
      g.add(pod);
      engineZ = Math.min(engineZ, p.z - p.l / 2);
    }
    if (d.nacelles) {
      const n = d.nacelles;
      const geo = new CylinderGeometry(n.r, n.r * 0.85, n.l, 16);
      geo.rotateX(Math.PI / 2);
      const nac = new Mesh(geo, accent);
      nac.position.set(sx * n.x, n.r * 0.8, n.z);
      g.add(nac);
      engineZ = Math.min(engineZ, n.z - n.l / 2);
    }
    if (d.fins) {
      const f = d.fins;
      const fin = new Mesh(new BoxGeometry(0.08, f.h, f.l), accent);
      fin.position.set(sx * f.x, d.thick + f.h / 2, f.z);
      fin.rotation.z = -sx * f.rake;
      g.add(fin);
    }
  }

  // réacteurs
  const flameMat = new MeshBasicMaterial({ color: neon(team.color, 2.2), transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false });
  const coreMat = new MeshBasicMaterial({ color: neon(team.color, 4) });
  const flames: Mesh[] = [];
  const ey = d.nacelles ? d.nacelles.r * 0.8 : d.pods && d.engines.some((x) => Math.abs(x) === d.pods!.x) ? d.pods.h / 2 : 0.2;
  const r = d.engineR;
  for (const sx of d.engines) {
    const nozzle = new CylinderGeometry(r, r * 1.2, 0.5, 14);
    nozzle.rotateX(Math.PI / 2);
    const engine = new Mesh(nozzle, dark);
    engine.position.set(sx, ey, engineZ);
    const coreGeo = new CircleGeometry(r * 0.9, 16);
    coreGeo.rotateY(Math.PI);
    const core = new Mesh(coreGeo, coreMat);
    core.position.set(sx, ey, engineZ - 0.26);
    const flameGeo = new ConeGeometry(r * 0.87, 2.4, 12, 1, true);
    flameGeo.translate(0, 1.2, 0);
    flameGeo.rotateX(-Math.PI / 2);
    const flame = new Mesh(flameGeo, flameMat);
    flame.position.set(sx, ey, engineZ - 0.25);
    g.add(engine, core, flame);
    flames.push(flame);
  }

  const glow = new Sprite(new SpriteMaterial({ map: tex.glow, color: neon(team.color, 1.5), blending: AdditiveBlending, depthWrite: false, transparent: true }));
  glow.position.set(0, ey, engineZ - 0.6);
  glow.scale.set(3.2, 2.2, 1);

  const underGeo = new PlaneGeometry(4.5, 6.5);
  underGeo.rotateX(-Math.PI / 2);
  const under = new Mesh(underGeo, new MeshBasicMaterial({ map: tex.glow, color: col.clone().multiplyScalar(0.9), transparent: true, opacity: 0.7, blending: AdditiveBlending, depthWrite: false }));
  under.position.y = -HOVER_HEIGHT + 0.08;

  const shield = new Mesh(
    new SphereGeometry(1, 22, 14),
    new MeshBasicMaterial({ color: neon(0x66ccff, 1.2), transparent: true, opacity: 0.22, blending: AdditiveBlending, depthWrite: false }),
  );
  shield.scale.set(2.5, 1.4, 3.7);
  shield.position.z = 0.4;
  shield.visible = false;

  g.add(glow, under, shield);
  g.userData = { flames, glow, shield };
  return g;
}
