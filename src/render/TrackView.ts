import {
  AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, DoubleSide, Group,
  InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, TorusGeometry, Vector3,
  type Material,
} from 'three';
import { GROUND_Y } from '../config';
import type { CircuitTheme } from '../track/circuits';
import { archPositions, colonnadeX, COLONNADE_SPACING, TUNNEL_CEILING, TUNNEL_WALL_MARGIN } from '../track/features';
import type { Track, Zone } from '../track/Track';
import { neon, type Textures } from './textures';

const UV_LENGTH = 24;
const PILLAR_EVERY = 30;
/** Un anneau lumineux tous les N échantillons dans les tunnels et les figures. */
const RING_EVERY = 10;

type Profile = readonly (readonly [number, number])[];

/** Géométrie statique de la piste : surface, murs, néons, piliers, portiques, tunnels. */
export function buildTrackView(track: Track, tex: Textures, theme: CircuitTheme): Group {
  const root = new Group();
  const h = track.halfWidth;
  const [cLeft, cRight] = theme.walls;
  const all: [number, number] = [0, track.count];

  const extrude = (profile: Profile, material: Material, range: readonly [number, number] = all, closed = range === all) =>
    root.add(new Mesh(profileGeometry(track, range[0], range[1], profile, closed), material));

  // surface + caisson
  extrude([[-h, 0], [h, 0]], new MeshStandardMaterial({ map: tex.road, roughness: 0.55, metalness: 0.35 }));
  const slab = new MeshStandardMaterial({ color: 0x1a1530, roughness: 0.8, metalness: 0.4, side: DoubleSide });
  extrude([[h, 0], [h, -1], [-h, -1], [-h, 0]], slab);

  // murs translucides
  const wall = (c: number) =>
    new MeshBasicMaterial({ color: new Color(c).multiplyScalar(0.3), transparent: true, opacity: 0.4, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
  extrude([[-h, 0], [-h - 0.3, 1.5]], wall(cLeft));
  extrude([[h, 0], [h + 0.3, 1.5]], wall(cRight));

  // néons
  const glow = (c: number, k: number) => new MeshBasicMaterial({ color: neon(c, k), side: DoubleSide });
  extrude([[-h - 0.28, 1.35], [-h - 0.32, 1.6]], glow(cLeft, 3));
  extrude([[h + 0.28, 1.35], [h + 0.32, 1.6]], glow(cRight, 3));
  extrude([[-h + 0.3, 0.03], [-h + 0.6, 0.03]], glow(cLeft, 1.6));
  extrude([[h - 0.6, 0.03], [h - 0.3, 0.03]], glow(cRight, 1.6));

  for (const zone of track.zones) {
    const range = zoneRange(track, zone);
    if (zone.kind === 'tunnel') buildTunnel(root, track, range, theme, extrude);
    else if (zone.kind === 'magnetic') buildMagneticRings(root, track, range, theme);
    else if (zone.kind === 'jump') buildJumpMarks(root, track, range, theme);
    else buildColonnade(root, track, zone, theme);
  }

  buildPillars(root, track);
  archPositions(track).forEach((s, k) => {
    if (k === 0) buildArch(root, track, tex, s, cRight, cLeft, true);
    else buildArch(root, track, tex, s, k % 2 ? cLeft : theme.sun[1], k % 2 ? cRight : theme.accent, false);
  });
  return root;
}

const zoneRange = (track: Track, z: Zone): [number, number] => [Math.round(z.from / track.spacing), Math.round(z.to / track.spacing)];

/**
 * Extrusion d'une section (points (x, y) dans le repère de la piste) entre les échantillons a et b.
 * `closed` relie le dernier échantillon au premier (tour complet).
 */
function profileGeometry(track: Track, a: number, b: number, profile: Profile, closed: boolean): BufferGeometry {
  const n = track.count;
  const rows = closed ? n + 1 : b - a + 1;
  const m = profile.length;
  const pos = new Float32Array(rows * m * 3);
  const uv = new Float32Array(rows * m * 2);
  const idx: number[] = [];
  const v = new Vector3();
  for (let row = 0; row < rows; row++) {
    const i = (a + row) % n;
    const p = track.points[i];
    const r = track.rights[i];
    const u = track.ups[i];
    for (let k = 0; k < m; k++) {
      const [x, y] = profile[k];
      v.copy(p).addScaledVector(r, x).addScaledVector(u, y);
      pos.set([v.x, v.y, v.z], (row * m + k) * 3);
      uv.set([k / Math.max(1, m - 1), (row * track.spacing) / UV_LENGTH], (row * m + k) * 2);
    }
    if (row < rows - 1) {
      for (let k = 0; k < m - 1; k++) {
        const A = row * m + k;
        idx.push(A, A + 1, A + m, A + 1, A + m + 1, A + m);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Tube octogonal fermé au-dessus de la piste, rampes lumineuses et anneaux. */
function buildTunnel(
  root: Group, track: Track, range: [number, number], theme: CircuitTheme,
  extrude: (profile: Profile, material: Material, range: readonly [number, number]) => void,
): void {
  const h = track.halfWidth + TUNNEL_WALL_MARGIN;
  const c = TUNNEL_CEILING;
  const shell: Profile = [[h, -1], [h, 6], [h - 4, c], [-h + 4, c], [-h, 6], [-h, -1]];
  extrude(shell, new MeshStandardMaterial({ color: 0x15121f, roughness: 0.9, metalness: 0.3, side: DoubleSide }), range);
  // rampes au plafond et en bas des parois
  const strip = new MeshBasicMaterial({ color: neon(theme.accent, 2.2), side: DoubleSide });
  for (const sx of [-1, 1]) {
    extrude([[sx * (h - 4.6), 10.3], [sx * (h - 3.8), 10.3]], strip, range);
    extrude([[sx * (h - 0.05), 2.2], [sx * (h - 0.05), 2.6]], new MeshBasicMaterial({ color: neon(theme.walls[sx < 0 ? 0 : 1], 2), side: DoubleSide }), range);
  }
  const ring: Profile = shell.map(([x, y]) => [x * 0.97, y * 0.97 + 0.2] as const);
  const ringMat = new MeshBasicMaterial({ color: neon(theme.accent, 1.4), side: DoubleSide });
  for (let i = range[0] + RING_EVERY; i < range[1] - 2; i += RING_EVERY) {
    root.add(new Mesh(profileGeometry(track, i, i + 1, ring, false), ringMat));
  }
  // portails
  const portal = new MeshBasicMaterial({ color: neon(0xffffff, 2) });
  for (const i of range) root.add(new Mesh(profileGeometry(track, i, i + 1, shell.map(([x, y]) => [x * 1.03, y * 1.03] as const), false), portal));
}

/** Piliers métalliques des deux côtés, coiffés d'un néon (ils renvoient le son : flutter echo). */
function buildColonnade(root: Group, track: Track, zone: Zone, theme: CircuitTheme): void {
  const list: number[] = [];
  for (let s = zone.from; s <= zone.to; s += COLONNADE_SPACING) list.push(s);
  const post = new BoxGeometry(0.9, 9, 0.9);
  post.translate(0, 4.5, 0);
  const cap = new BoxGeometry(1.3, 0.5, 1.3);
  cap.translate(0, 9.2, 0);
  const posts = new InstancedMesh(post, new MeshStandardMaterial({ color: 0x8a8aa0, metalness: 0.85, roughness: 0.25 }), list.length * 2);
  const caps = new InstancedMesh(cap, new MeshBasicMaterial({ color: neon(theme.accent, 2.6) }), list.length * 2);
  const holder = new Group();
  const m = new Matrix4();
  let k = 0;
  for (const s of list) {
    for (const side of [-1, 1]) {
      track.place(holder, s, side * colonnadeX(track), 0);
      holder.updateMatrix();
      posts.setMatrixAt(k, m.copy(holder.matrix));
      caps.setMatrixAt(k, m);
      k++;
    }
  }
  root.add(posts, caps);
}

/** Tremplin : chevrons néon sur la rampe, ligne d'appel au sommet, balises latérales. */
function buildJumpMarks(root: Group, track: Track, range: [number, number], theme: CircuitTheme): void {
  const h = track.halfWidth;
  // la rampe est la première moitié de la zone : du pied au sommet
  const crest = range[0] + Math.round((range[1] - range[0]) * 0.45);
  const chevron = new MeshBasicMaterial({ color: neon(theme.walls[0], 2.2), side: DoubleSide });
  const lip = new MeshBasicMaterial({ color: neon(theme.sun[1], 3.5), side: DoubleSide });
  for (let i = range[0]; i < crest - 1; i += 3) {
    // deux bandes en V pointant vers l'avant, posées sur la piste
    root.add(new Mesh(profileGeometry(track, i, i + 1, [[-h + 0.8, 0.04], [-1, 0.04]], false), chevron));
    root.add(new Mesh(profileGeometry(track, i + 1, i + 2, [[1, 0.04], [h - 0.8, 0.04]], false), chevron));
  }
  root.add(new Mesh(profileGeometry(track, crest, crest + 1, [[-h, 0.05], [h, 0.05]], false), lip));
  // balises aux murs sur toute la zone
  const post: Profile = [[h + 0.35, 0], [h + 0.35, 3.2]];
  const postL: Profile = [[-h - 0.35, 0], [-h - 0.35, 3.2]];
  for (let i = range[0]; i <= crest; i += 4) {
    root.add(new Mesh(profileGeometry(track, i, i + 1, post, false), lip));
    root.add(new Mesh(profileGeometry(track, i, i + 1, postL, false), lip));
  }
}

/** Arceaux lumineux le long des loopings et tire-bouchons (lisibilité de la trajectoire). */
function buildMagneticRings(root: Group, track: Track, range: [number, number], theme: CircuitTheme): void {
  const h = track.halfWidth;
  const arc: Profile = [[h + 0.4, 0], [h + 0.4, 3], [h - 1.5, 5], [-h + 1.5, 5], [-h - 0.4, 3], [-h - 0.4, 0]];
  const mat = new MeshBasicMaterial({ color: neon(theme.accent, 2.4), side: DoubleSide });
  for (let i = range[0]; i <= range[1]; i += RING_EVERY) {
    root.add(new Mesh(profileGeometry(track, i, i + 1, arc, false), mat));
  }
}

function buildPillars(root: Group, track: Track): void {
  const list: [number, number, number][] = [];
  for (let i = 0; i < track.count; i += PILLAR_EVERY) {
    if (track.magnetic[i] || track.ups[i].y < 0.8) continue;
    const p = track.points[i];
    const height = p.y - 1 - GROUND_Y;
    if (height > 4) list.push([p.x, p.z, height]);
  }
  const geo = new CylinderGeometry(1.1, 1.6, 1, 8);
  geo.translate(0, 0.5, 0);
  const pillars = new InstancedMesh(geo, new MeshStandardMaterial({ color: 0x241c3d, roughness: 0.7, metalness: 0.5 }), list.length);
  const ringGeo = new TorusGeometry(2.4, 0.12, 6, 24);
  ringGeo.rotateX(Math.PI / 2);
  const rings = new InstancedMesh(ringGeo, new MeshBasicMaterial({ color: neon(0x9a7bff, 2) }), list.length);
  const m = new Matrix4();
  list.forEach(([x, z, height], k) => {
    pillars.setMatrixAt(k, m.makeScale(1, height, 1).setPosition(x, GROUND_Y, z));
    rings.setMatrixAt(k, m.makeTranslation(x, GROUND_Y + 0.3, z));
  });
  root.add(pillars, rings);
}

function buildArch(root: Group, track: Track, tex: Textures, s: number, colorA: number, colorB: number, start: boolean): void {
  const g = new Group();
  const height = start ? 11 : 8.5;
  const w = track.halfWidth + 1.5;
  const post = new BoxGeometry(0.8, height, 0.8);
  const left = new Mesh(post, new MeshBasicMaterial({ color: neon(colorA, 2.6) }));
  left.position.set(w, height / 2, 0);
  const right = new Mesh(post, new MeshBasicMaterial({ color: neon(colorB, 2.6) }));
  right.position.set(-w, height / 2, 0);
  const beam = new Mesh(new BoxGeometry(2 * w + 0.8, 0.6, 0.8), new MeshBasicMaterial({ color: neon(0xffffff, start ? 2.2 : 1.4) }));
  beam.position.set(0, height, 0);
  g.add(left, right, beam);

  if (start) {
    const banner = new Mesh(new PlaneGeometry(2 * w, 3), new MeshBasicMaterial({ map: tex.banner, side: DoubleSide }));
    banner.position.set(0, height - 1.5, 0);
    banner.rotation.y = Math.PI;
    const line = new Mesh(new PlaneGeometry(2 * track.halfWidth, 2.4), new MeshBasicMaterial({ map: tex.checker }));
    line.rotation.x = -Math.PI / 2;
    line.position.y = 0.04;
    g.add(banner, line);
  }
  track.place(g, s, 0, 0);
  root.add(g);
}
