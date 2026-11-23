import {
  BoxGeometry, BufferGeometry, Color, ConeGeometry, DoubleSide, EdgesGeometry, Group, InstancedMesh, LineBasicMaterial, LineSegments,
  Matrix4, Mesh, MeshBasicMaterial, type Object3D, MeshStandardMaterial, OctahedronGeometry, Quaternion, Shape, ShapeGeometry, Vector3,
} from 'three';
import { GROUND_Y } from '../../config';
import { neon } from '../textures';
import type { GlowParticles } from './GlowParticles';
import { follow, type MusicBands } from './MusicBands';
import type { GroundField } from './ReactiveGround';

const DRAGON_COUNT = 3;
const SEGMENTS = 22;
const SEGMENT_LENGTH = 2.7;
/** Segment qui porte les ailes. */
const WING_SEGMENT = 3;
/** Délai minimal entre deux jaillissements (s). */
const SPAWN_COOLDOWN = 3.5;
/** Temps de vol minimal avant de pouvoir replonger, et maximal (s). */
const MIN_FLIGHT = 7;
const MAX_FLIGHT = 45;
/** Accalmie des graves qui renvoie les dragons sous terre (s). */
const CALM_TO_DIVE = 1.6;
const FLY_SPEED = 46;
/** Vitesse max (m/s) : doit dépasser celle des vaisseaux pour rester dans le champ de vision. */
const MAX_SPEED = 170;
/** Les dragons évoluent autour d'un point à cette distance devant la caméra (m). */
const AHEAD = 240;

type State = 'hidden' | 'emerging' | 'flying' | 'diving';

const UP = new Vector3(0, 1, 0);
const ALT_UP = new Vector3(0, 0, 1);

/**
 * Trois dragons procéduraux tapis sous le sol réactif. Un drop (graves forts dans un passage dense)
 * en fait jaillir un ; en vol, il trace des courbes sinusoïdales au-dessus du terrain, bat des ailes
 * au tempo (amplitude = médiums), ouvre la gueule et crache des particules sur les pics d'aigus,
 * puis replonge quand les graves retombent.
 */
export class Dragons {
  readonly root = new Group();
  private readonly dragons: Dragon[] = [];
  private readonly body: InstancedMesh;
  private readonly spines: InstancedMesh;
  private readonly spineMat: MeshBasicMaterial;
  private readonly eyeMat: MeshBasicMaterial;
  private readonly spineColor: Color;
  private readonly eyeColor: Color;
  private cooldown = 1;
  private next = 0;
  private readonly m = new Matrix4();
  private readonly s = new Vector3();
  private readonly q = new Quaternion();
  private readonly up = new Vector3();
  /** Point d'ancrage du vol, devant la caméra, lissé. */
  private readonly anchor = new Vector3();
  private readonly forward = new Vector3();
  private readonly camPos = new Vector3();
  private anchored = false;

  constructor(
    private readonly field: GroundField,
    private readonly particles: GlowParticles,
    private readonly palette: { readonly glow: number; readonly fire: number },
    private readonly avoid: (x: number, z: number) => number,
  ) {
    const dark = new MeshStandardMaterial({ color: 0x1a1a24, metalness: 0.8, roughness: 0.35, flatShading: true });
    this.spineColor = neon(palette.glow, 2.2);
    this.eyeColor = neon(palette.fire, 4);
    this.spineMat = new MeshBasicMaterial({ color: this.spineColor.clone() });
    this.eyeMat = new MeshBasicMaterial({ color: this.eyeColor.clone() });

    const seg = new OctahedronGeometry(1, 0);
    seg.scale(1, 0.75, 1.5);
    this.body = new InstancedMesh(seg, dark, DRAGON_COUNT * SEGMENTS);
    const spine = new ConeGeometry(0.35, 1.8, 4);
    spine.rotateX(-0.5); // inclinée vers l'arrière
    this.spines = new InstancedMesh(spine, this.spineMat, DRAGON_COUNT * SEGMENTS);
    this.body.frustumCulled = this.spines.frustumCulled = false;
    this.root.add(this.body, this.spines);

    for (let k = 0; k < DRAGON_COUNT; k++) {
      const d = new Dragon(k, dark, this.spineMat, this.eyeMat, palette.glow);
      this.dragons.push(d);
      this.root.add(d.head, d.wingL, d.wingR);
    }
    this.writeInstances();
  }

  /** Au moins un dragon est hors du sol (jaillissement ou vol) : la musique fait entrer son rugissement. */
  get active(): boolean {
    return this.dragons.some((d) => d.state === 'emerging' || d.state === 'flying');
  }

  /** `camera` : les dragons jaillissent et volent devant elle, pour être vus du joueur. */
  update(dt: number, bands: MusicBands, camera: Object3D): void {
    if (dt <= 0) return;
    const f = bands.features;
    this.cooldown -= dt;
    this.track(camera, dt);

    if (bands.drop && this.cooldown <= 0) {
      const d = this.dragons.find((x) => x.state === 'hidden');
      if (d) {
        this.spawn(d);
        this.cooldown = SPAWN_COOLDOWN;
      }
    }

    for (const d of this.dragons) {
      if (d.state === 'hidden') continue;
      d.age += dt;
      if (d.state === 'flying' && d.age > MIN_FLIGHT && (bands.calmFor > CALM_TO_DIVE || d.age > MAX_FLIGHT)) this.dive(d);
      this.steer(d, dt);
      d.solve(dt, f.beats);
      this.groundCrossings(d);
      // ailes au tempo : un battement par blanche, amplitude portée par les médiums
      const amp = 0.25 + 0.85 * bands.mid + 0.35 * f.env.snare;
      d.flap = follow(d.flap, amp, dt, 12, 3);
      d.placeWings(Math.sin(f.beats * Math.PI + d.index * 0.9) * d.flap);
      // gueule : s'ouvre sur les pics d'aigus et crache
      const open = bands.high > 0.42 ? 0.25 + 0.7 * bands.high : 0.06;
      d.jawOpen = follow(d.jawOpen, open, dt, 30, 7);
      d.jaw.rotation.x = d.jawOpen;
      if (d.jawOpen > 0.38 && d.head.position.y > GROUND_Y + 2) this.breathe(d, dt, bands.high);
    }

    // néons des épines et des yeux : pulsent avec les graves / aigus
    this.spineMat.color.copy(this.spineColor).multiplyScalar(0.6 + 1.6 * bands.bass);
    this.eyeMat.color.copy(this.eyeColor).multiplyScalar(0.5 + 1.5 * bands.high);
    this.writeInstances();
  }

  // ------------------------------------------------------------------ comportement

  /** Ancre lissée devant la caméra (à plat : on regarde le terrain, pas le ciel). */
  private track(camera: Object3D, dt: number): void {
    camera.getWorldPosition(this.camPos);
    camera.getWorldDirection(this.forward).setY(0);
    if (this.forward.lengthSq() < 1e-6) this.forward.set(0, 0, -1);
    this.forward.normalize();
    const target = this.up.copy(this.camPos).addScaledVector(this.forward, AHEAD).setY(GROUND_Y);
    // rester au-dessus du champ de colonnes
    const { center, radius } = this.field;
    const off = target.sub(center);
    const max = radius * 0.8;
    if (off.lengthSq() > max * max) off.setLength(max);
    target.add(center);
    if (!this.anchored) this.anchor.copy(target);
    this.anchored = true;
    this.anchor.lerp(target, 1 - Math.exp(-dt * 1.5));
  }

  private spawn(d: Dragon): void {
    // dans le champ de vision, sur un côté, à l'écart de la piste
    const side = this.up.set(-this.forward.z, 0, this.forward.x);
    let x = this.anchor.x;
    let z = this.anchor.z;
    for (let tries = 0; tries < 30; tries++) {
      const lateral = (Math.random() < 0.5 ? -1 : 1) * (50 + Math.random() * 130);
      const along = -90 + Math.random() * 150;
      x = this.anchor.x + side.x * lateral + this.forward.x * along;
      z = this.anchor.z + side.z * lateral + this.forward.z * along;
      if (this.avoid(x, z) > 40) break;
    }
    d.reset(x, z);
    d.state = 'emerging';
    d.age = 0;
    d.orbit = Math.atan2(z - this.anchor.z, x - this.anchor.x);
    d.orbitDir = (this.next++ & 1) ? 1 : -1;
    d.orbitRadius = 80 + Math.random() * 80;
    d.altitude = 50 + Math.random() * 40;
    d.velocity.set(0, 70, 0);
    // jaillissement : gerbe de particules
    const at = this.s.set(x, GROUND_Y + 1, z);
    this.particles.emit(at, 220, new Vector3(0, 28, 0), 22, neon(this.palette.glow, 3.5), 1.6, { drag: 1.4, gravity: 14 });
    this.particles.emit(at, 80, new Vector3(0, 5, 0), 40, neon(this.palette.fire, 3), 1.0, { drag: 3, gravity: 2 });
    for (const g of [d.head, d.wingL, d.wingR]) g.visible = true;
  }

  private dive(d: Dragon): void {
    d.state = 'diving';
    const ahead = this.s.copy(d.velocity).setY(0).normalize().multiplyScalar(80);
    d.diveTarget.set(d.head.position.x + ahead.x, GROUND_Y - 150, d.head.position.z + ahead.z);
  }

  private steer(d: Dragon, dt: number): void {
    const head = d.head.position;
    const center = this.anchor;
    const desired = this.s;
    if (d.state === 'emerging') {
      // monte d'abord à la verticale, puis s'incline vers sa trajectoire
      desired.set(0, 60, 0);
      if (head.y > GROUND_Y + d.altitude * 0.6) d.state = 'flying';
    } else if (d.state === 'flying') {
      // courbes sinusoïdales : orbite déformée + ondulations en altitude et en rayon
      d.orbit += (d.orbitDir * FLY_SPEED * dt) / d.orbitRadius;
      const r = d.orbitRadius * (1 + 0.35 * Math.sin(d.orbit * 2.3 + d.index));
      const tx = center.x + Math.cos(d.orbit) * r;
      const tz = center.z + Math.sin(d.orbit) * r;
      // au-dessus du terrain, et au-dessus de la caméra pour ne pas la percuter
      const floor = Math.max(GROUND_Y + d.altitude, this.camPos.y + 18);
      const ty = floor + 20 * Math.sin(d.orbit * 3 + d.index * 2);
      // poursuite de la cible mobile (l'ancre avance avec la caméra)
      desired.set(tx - head.x, ty - head.y, tz - head.z).multiplyScalar(1.6);
      const len = desired.length();
      if (len > MAX_SPEED) desired.multiplyScalar(MAX_SPEED / len);
      else if (len < FLY_SPEED * 0.6) desired.setLength(FLY_SPEED * 0.6);
    } else {
      desired.copy(d.diveTarget).sub(head).setLength(FLY_SPEED * 1.4);
      if (d.tailY() < GROUND_Y - 4) this.hide(d);
    }
    d.velocity.lerp(desired, Math.min(1, dt * (d.state === 'diving' ? 2.5 : 1.6)));
    head.addScaledVector(d.velocity, dt);
  }

  private hide(d: Dragon): void {
    d.state = 'hidden';
    for (const g of [d.head, d.wingL, d.wingR]) g.visible = false;
  }

  /** Chaque segment qui traverse le sol (dans un sens ou l'autre) soulève des particules. */
  private groundCrossings(d: Dragon): void {
    const color = neon(this.palette.glow, 3);
    for (let k = 0; k < SEGMENTS; k++) {
      const y = d.points[k].y;
      const before = d.prevY[k];
      d.prevY[k] = y;
      if ((before - GROUND_Y) * (y - GROUND_Y) >= 0) continue;
      this.s.set(d.points[k].x, GROUND_Y + 0.5, d.points[k].z);
      this.particles.emit(this.s, 14, new Vector3(0, 14, 0), 12, color, 1.1, { drag: 1.5, gravity: 10 });
    }
  }

  private breathe(d: Dragon, dt: number, high: number): void {
    const mouth = d.mouth(this.s);
    const dir = new Vector3(0, 0, 1).applyQuaternion(d.head.quaternion).multiplyScalar(75).add(d.velocity);
    const count = Math.ceil(high * 140 * dt);
    this.particles.emit(mouth, count, dir, 7, neon(this.palette.fire, 3.2), 0.8, { drag: 1.6, gravity: -3 });
  }

  // ------------------------------------------------------------------ rendu

  private writeInstances(): void {
    const { m, s, q } = this;
    for (const d of this.dragons) {
      for (let k = 0; k < SEGMENTS; k++) {
        const i = d.index * SEGMENTS + k;
        if (d.state === 'hidden') {
          m.makeScale(0, 0, 0);
          this.body.setMatrixAt(i, m);
          this.spines.setMatrixAt(i, m);
          continue;
        }
        d.segmentRotation(k, q);
        const taper = segmentScale(k);
        m.compose(d.points[k], q, s.setScalar(taper));
        this.body.setMatrixAt(i, m);
        // épine sur le dos
        const up = this.up.set(0, 0.8 * taper, 0).applyQuaternion(q).add(d.points[k]);
        m.compose(up, q, s.setScalar(taper * 0.9));
        this.spines.setMatrixAt(i, m);
      }
    }
    this.body.instanceMatrix.needsUpdate = true;
    this.spines.instanceMatrix.needsUpdate = true;
  }
}

/** Corps effilé : large derrière la tête, fin au bout de la queue. */
function segmentScale(k: number): number {
  const t = k / (SEGMENTS - 1);
  return 2.3 * (1 - t) ** 0.8 + 0.35;
}

/** Un dragon : tête articulée (mâchoire), corps à segments qui suit la tête, deux ailes. */
class Dragon {
  state: State = 'hidden';
  age = 0;
  orbit = 0;
  orbitDir = 1;
  orbitRadius = 200;
  altitude = 60;
  flap = 0;
  jawOpen = 0;
  readonly velocity = new Vector3();
  readonly diveTarget = new Vector3();
  readonly points: Vector3[] = [];
  readonly prevY: number[] = [];
  readonly head = new Group();
  readonly jaw = new Group();
  readonly wingL = new Group();
  readonly wingR = new Group();
  private readonly rot: Quaternion[] = [];
  private readonly m = new Matrix4();
  private readonly v = new Vector3();
  private readonly side = new Vector3();

  constructor(readonly index: number, dark: MeshStandardMaterial, glow: MeshBasicMaterial, eye: MeshBasicMaterial, edge: number) {
    for (let k = 0; k < SEGMENTS; k++) {
      this.points.push(new Vector3(0, GROUND_Y - 200, 0));
      this.prevY.push(GROUND_Y - 200);
      this.rot.push(new Quaternion());
    }
    this.buildHead(dark, glow, eye);
    this.buildWings(dark, edge);
    this.head.visible = this.wingL.visible = this.wingR.visible = false;
  }

  /** Tête dressée sous le sol, corps empilé verticalement : il sortira de terre segment par segment. */
  reset(x: number, z: number): void {
    this.head.position.set(x, GROUND_Y - 4, z);
    for (let k = 0; k < SEGMENTS; k++) {
      this.points[k].set(x, GROUND_Y - 4 - k * SEGMENT_LENGTH, z);
      this.prevY[k] = this.points[k].y;
    }
  }

  tailY(): number {
    return this.points[SEGMENTS - 1].y;
  }

  /** Corps : chaque segment est tiré par le précédent (corde), avec une ondulation latérale. */
  solve(dt: number, beats: number): void {
    const p = this.points;
    p[0].copy(this.head.position);
    for (let k = 1; k < SEGMENTS; k++) {
      const d = this.v.subVectors(p[k], p[k - 1]);
      const len = d.length();
      if (len > SEGMENT_LENGTH) p[k].copy(p[k - 1]).addScaledVector(d, SEGMENT_LENGTH / len);
    }
    // ondulation : petite poussée latérale qui remonte le corps
    for (let k = 2; k < SEGMENTS; k++) {
      this.v.subVectors(p[k - 1], p[k]);
      const up = Math.abs(this.v.y) > 0.95 * this.v.length() ? ALT_UP : UP;
      this.side.crossVectors(this.v, up).normalize();
      p[k].addScaledVector(this.side, Math.sin(beats * Math.PI * 0.5 - k * 0.45 + this.index) * 0.6 * (k / SEGMENTS) * dt * 6);
    }
    for (let k = 0; k < SEGMENTS; k++) {
      const ahead = k === 0 ? this.v.copy(p[0]).add(this.velocity) : p[k - 1];
      this.rot[k].setFromRotationMatrix(lookFrom(this.m, p[k], ahead));
    }
    this.head.quaternion.copy(this.rot[0]);
  }

  segmentRotation(k: number, out: Quaternion): Quaternion {
    return out.copy(this.rot[k]);
  }

  placeWings(angle: number): void {
    const p = this.points[WING_SEGMENT];
    const q = this.rot[WING_SEGMENT];
    for (const [wing, sign] of [[this.wingL, 1], [this.wingR, -1]] as const) {
      wing.position.copy(p);
      wing.quaternion.copy(q);
      // le battement tourne l'aile autour de l'axe du corps
      wing.rotateZ(sign * (angle + 0.15));
    }
  }

  mouth(out: Vector3): Vector3 {
    return out.set(0, -0.4, 7.5).applyQuaternion(this.head.quaternion).add(this.head.position);
  }

  private buildHead(dark: MeshStandardMaterial, glow: MeshBasicMaterial, eye: MeshBasicMaterial): void {
    // crâne anguleux : un bloc et un museau pyramidal vers l'avant (+z)
    const skull = new Mesh(new BoxGeometry(2.6, 1.8, 2.6), dark);
    const snout = new Mesh(pyramid(2.2, 1.2, 4.2), dark);
    snout.position.set(0, 0.15, 1.3);
    // mâchoire articulée : pivot à l'arrière du crâne
    const lower = new Mesh(pyramid(1.9, 0.6, 4.6), dark);
    lower.position.set(0, -0.3, 2.3);
    this.jaw.position.set(0, -0.6, -0.9);
    this.jaw.add(lower);
    // cornes et yeux néon
    for (const sx of [-1, 1]) {
      const horn = new Mesh(new ConeGeometry(0.35, 3.4, 4), glow);
      horn.position.set(sx * 0.9, 1.2, -1.6);
      horn.rotation.set(-1.1, 0, sx * -0.3);
      const e = new Mesh(new BoxGeometry(0.5, 0.25, 0.7), eye);
      e.position.set(sx * 1.05, 0.55, 1.0);
      e.rotation.z = sx * 0.3;
      this.head.add(horn, e);
    }
    this.head.add(skull, snout, this.jaw);
    this.head.scale.setScalar(1.4);
  }

  private buildWings(dark: MeshStandardMaterial, edge: number): void {
    // aile géométrique : membrane polygonale + nervures au néon. Axe x = envergure, z = vers l'avant.
    const outline: [number, number][] = [[0, 2], [7, 4], [16, 5], [24, 1], [19, -3], [21, -8], [13, -6], [12, -11], [5, -7], [0, -5]];
    const shape = new Shape();
    outline.forEach(([x, z], i) => (i ? shape.lineTo(x, z) : shape.moveTo(x, z)));
    const membrane = new ShapeGeometry(shape);
    membrane.rotateX(Math.PI / 2); // plan xy → plan xz : le y de la forme devient z (avant)
    const mat = dark.clone();
    mat.side = DoubleSide;
    mat.transparent = true;
    mat.opacity = 0.85;
    mat.emissive = neon(edge, 0.15);
    const ribs = new LineSegments(
      new EdgesGeometry(membrane),
      new LineBasicMaterial({ color: neon(edge, 2.6) }),
    );
    const bones = new LineSegments(fanBones(outline), new LineBasicMaterial({ color: neon(edge, 1.8) }));
    for (const [wing, sx] of [[this.wingL, 1], [this.wingR, -1]] as const) {
      const g = new Group();
      g.add(new Mesh(membrane, mat), ribs.clone(), bones.clone());
      g.scale.set(sx, 1, 1);
      g.position.y = 0.6;
      wing.add(g);
    }
  }
}

/** Matrice de rotation orientant +z de `from` vers `to` (convention des objets, pas des caméras). */
function lookFrom(m: Matrix4, from: Vector3, to: Vector3): Matrix4 {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  const up = Math.abs(dy / len) > 0.98 ? ALT_UP : UP;
  // Matrix4.lookAt(eye, target) aligne +z sur (eye - target)
  return m.lookAt(to, from, up);
}

/** Pyramide à base rectangulaire (largeur, hauteur) pointant vers +z, base en z = 0. */
function pyramid(w: number, h: number, length: number): BufferGeometry {
  const g = new ConeGeometry(Math.SQRT1_2, 1, 4, 1);
  g.rotateY(Math.PI / 4);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, 0.5);
  g.scale(w, h, length);
  return g.toNonIndexed();
}

/** Nervures : du point d'attache vers chaque pointe de l'aile. */
function fanBones(outline: readonly [number, number][]): BufferGeometry {
  const pts: Vector3[] = [];
  for (const i of [2, 3, 5, 7]) pts.push(new Vector3(0, 0, 0), new Vector3(outline[i][0], 0, outline[i][1]));
  return new BufferGeometry().setFromPoints(pts);
}
