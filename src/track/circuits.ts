import { LayoutBuilder } from './LayoutBuilder';
import type { TrackLayout } from './Track';

export type Scenery = 'city' | 'peaks' | 'volcano' | 'moon';

/** Ambiance visuelle d'un circuit. Couleurs en hexadécimal. */
export interface CircuitTheme {
  /** Ciel : horizon, milieu, zénith. */
  readonly sky: readonly [number, number, number];
  readonly fog: number;
  readonly fogDensity: number;
  readonly ground: number;
  readonly grid: readonly [number, number];
  /** Néons gauche / droite de la piste. */
  readonly walls: readonly [number, number];
  /** Éclairage du tunnel et des portiques. */
  readonly accent: number;
  readonly sun: readonly [number, number];
  readonly scenery: Scenery;
}

export interface Circuit {
  readonly id: string;
  readonly name: string;
  readonly location: string;
  readonly features: readonly string[];
  readonly layout: TrackLayout;
  readonly theme: CircuitTheme;
}

// ------------------------------------------------------------------ Neon Ridge : la ville

function neonRidge(): TrackLayout {
  const b = new LayoutBuilder()
    .to(0, 0, 0).to(180, 2, 0).to(330, 4, -10).colonnade(1).to(450, 12, -80).to(490, 26, -230).to(400, 36, -370)
    .to(240, 26, -360);
  const t0 = b.here();
  b.to(130, 10, -440).to(150, 0, -590).tunnel(t0)
    .to(300, -8, -680).to(460, 4, -650).to(570, 30, -760).to(520, 52, -910).to(320, 44, -970).to(80, 24, -920)
    .to(-140, 6, -820).to(-260, -6, -620).to(-210, 8, -420).to(-310, 22, -250).to(-260, 12, -90).to(-130, 2, -5);
  return b.build();
}

// ------------------------------------------------------------------ Glacier Vault : montagne, looping, long tunnel

function glacierVault(): TrackLayout {
  const b = new LayoutBuilder()
    .to(0, 0, 0).to(170, 0, 0)
    .loop({ radius: 36, offset: 32, side: 1 })
    .to(460, 8, 54).to(630, 18, 12).to(720, 26, -130).to(700, 34, -310);
  const t0 = b.here();
  b.to(565, 30, -420).to(385, 18, -455).to(205, 6, -430).tunnel(t0);
  const c0 = b.here();
  b.to(35, -4, -490).to(-145, 6, -575).colonnade(c0).to(-335, 20, -530).to(-420, 24, -360).to(-375, 14, -180).to(-205, 4, -48);
  return b.build();
}

// ------------------------------------------------------------------ Magma Rift : volcan, tire-bouchon, coulée en tunnel, looping

function magmaRift(): TrackLayout {
  const b = new LayoutBuilder()
    .to(0, 0, 0).to(160, 0, 0)
    .corkscrew({ length: 260, dir: 1, lead: 60 })
    .to(650, 8, -40).to(720, 20, -170).to(650, 30, -320).to(530, 36, -400).to(380, 30, -420);
  const t0 = b.here();
  b.to(240, 18, -450).to(120, 8, -520).tunnel(t0);
  const c0 = b.here();
  b.to(40, 4, -650).colonnade(c0).to(-90, 10, -730).to(-240, 14, -670).to(-300, 10, -530).to(-310, 6, -430)
    .loop({ radius: 34, offset: 32, side: 1 })
    .to(-330, 4, -230).to(-260, 2, -100).to(-130, 0, -15);
  return b.build();
}

// ------------------------------------------------------------------ Selene Orbital : base lunaire, tout à la fois

function seleneOrbital(): TrackLayout {
  const b = new LayoutBuilder().to(0, 0, 0).to(150, 0, 0);
  const t0 = b.here();
  b.to(300, -4, -30).to(420, -6, -110).tunnel(t0)
    .to(470, 0, -240).to(440, 8, -370).to(425, 10, -450)
    .loop({ radius: 38, offset: 32, side: -1 })
    .to(330, 12, -640).to(190, 12, -680)
    .corkscrew({ length: 260, dir: -1, lead: 60 })
    .to(-290, 6, -790).to(-400, 2, -660).to(-430, 0, -510);
  const t1 = b.here();
  b.to(-400, -4, -360).to(-320, -2, -220).tunnel(t1);
  const c1 = b.here();
  b.to(-170, 0, -70).colonnade(c1);
  return b.build();
}

export const CIRCUITS: readonly Circuit[] = [
  {
    id: 'neon',
    name: 'NEON RIDGE',
    location: 'Mégapole · nuit',
    features: ['TUNNEL', 'COLONNADE', 'DÉNIVELÉ'],
    layout: neonRidge(),
    theme: {
      sky: [0x6b1750, 0x120424, 0x020108], fog: 0x210924, fogDensity: 0.0011, ground: 0x07030f,
      grid: [0xff3fb4, 0x7a2cff], walls: [0x2ef2ff, 0xff3fb4], accent: 0x9a7bff, sun: [0xff4fcc, 0xffd35a], scenery: 'city',
    },
  },
  {
    id: 'glacier',
    name: 'GLACIER VAULT',
    location: 'Haute montagne · aube',
    features: ['LOOPING', 'LONG TUNNEL'],
    layout: glacierVault(),
    theme: {
      sky: [0x8fd6ff, 0x2a4f9a, 0x060c2a], fog: 0x3a5d8c, fogDensity: 0.0009, ground: 0x0c1830,
      grid: [0x8fe8ff, 0x3a7bff], walls: [0x8fe8ff, 0xb59bff], accent: 0x6fd8ff, sun: [0xffffff, 0xbfe8ff], scenery: 'peaks',
    },
  },
  {
    id: 'magma',
    name: 'MAGMA RIFT',
    location: 'Île volcanique · crépuscule',
    features: ['TIRE-BOUCHON', 'LOOPING', 'TUNNEL'],
    layout: magmaRift(),
    theme: {
      sky: [0xff5a1f, 0x5a0c14, 0x0c0204], fog: 0x3a0d08, fogDensity: 0.0012, ground: 0x120402,
      grid: [0xff6a1f, 0xff1f3a], walls: [0xffb02e, 0xff2e4a], accent: 0xff6a1f, sun: [0xff3a1f, 0xffd04a], scenery: 'volcano',
    },
  },
  {
    id: 'selene',
    name: 'SELENE ORBITAL',
    location: 'Base lunaire · éclipse',
    features: ['LOOPING', 'TIRE-BOUCHON', '2 TUNNELS'],
    layout: seleneOrbital(),
    theme: {
      sky: [0x1a2a3a, 0x05070f, 0x000000], fog: 0x05070f, fogDensity: 0.0006, ground: 0x1a1a1f,
      grid: [0x7dff4a, 0x2ef2a0], walls: [0x7dff4a, 0x9ab8ff], accent: 0x7dff4a, sun: [0x9ab8ff, 0xffffff], scenery: 'moon',
    },
  },
];

export const circuitById = (id: string): Circuit => CIRCUITS.find((c) => c.id === id) ?? CIRCUITS[0];
