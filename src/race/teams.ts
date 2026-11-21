import type { Difficulty } from '../config';

/** Caractéristiques affichées d'un engin, de 1 à 10 (la masse n'est ni bonne ni mauvaise). */
export interface TeamStats {
  readonly speed: number;
  readonly thrust: number;
  readonly handling: number;
  readonly shield: number;
  readonly weapon: number;
  readonly mass: number;
}

/** Silhouette du modèle 3D. */
export type HullStyle = 'dart' | 'twinboom' | 'twinengine' | 'brick' | 'arrow' | 'wedge' | 'mono' | 'needle';

export interface Team {
  readonly id: string;
  readonly name: string;
  readonly ship: string;
  readonly color: number;
  readonly trim: number;
  readonly hull: HullStyle;
  readonly blurb: string;
  readonly stats: TeamStats;
  /** Efficacité du freinage (1 = normal). */
  readonly brake?: number;
}

/**
 * Huit écuries, chacune avec un profil marqué : on choisit son engin selon son style
 * de pilotage et selon le circuit (maniabilité pour les épingles, vitesse pour les longues lignes…).
 */
export const TEAMS: readonly Team[] = [
  {
    id: 'aurora', name: 'AURORA', ship: 'AX-1 Halo', color: 0x2ef2ff, trim: 0xffffff, hull: 'dart',
    blurb: 'Très maniable et assez solide. Idéale pour débuter.',
    stats: { speed: 5, thrust: 6, handling: 9, shield: 6, weapon: 5, mass: 4 },
  },
  {
    id: 'vekta', name: 'VEKTA', ship: 'V-22 Stiletto', color: 0xff3fb4, trim: 0x2a0a2a, hull: 'twinboom',
    blurb: 'Bipoutre léger : accélère fort et frappe fort, mais casse vite.',
    stats: { speed: 6, thrust: 9, handling: 6, shield: 3, weapon: 9, mass: 2 },
  },
  {
    id: 'kaijin', name: 'KAIJIN', ship: 'KJ Raiden', color: 0xff8a1f, trim: 0x1a1a2a, hull: 'twinengine',
    blurb: 'Deux réacteurs, lourd à lancer, robuste avec une arme efficace.',
    stats: { speed: 7, thrust: 4, handling: 5, shield: 7, weapon: 7, mass: 7 },
  },
  {
    id: 'titanus', name: 'TITANUS', ship: 'T-90 Bastion', color: 0xffe14a, trim: 0x30260a, hull: 'brick',
    blurb: 'Un char volant : quasi indestructible, armement lourd, exigeant en virage.',
    stats: { speed: 6, thrust: 4, handling: 3, shield: 10, weapon: 9, mass: 10 },
  },
  {
    id: 'longma', name: 'LONGMA', ship: 'LM-8 Dragon', color: 0xff3a3a, trim: 0xffd34d, hull: 'arrow',
    blurb: 'Polyvalente : bonne accélération, bonne maniabilité, bonne arme.',
    stats: { speed: 6, thrust: 7, handling: 7, shield: 5, weapon: 7, mass: 5 },
  },
  {
    id: 'boreal', name: 'BOREAL', ship: 'BR-6 Mammoth', color: 0xa36bff, trim: 0xe8e0ff, hull: 'wedge',
    blurb: 'Lourde : mise tout sur la vitesse de pointe et la solidité.',
    stats: { speed: 9, thrust: 5, handling: 3, shield: 8, weapon: 5, mass: 9 },
  },
  {
    id: 'nordlys', name: 'NORDLYS', ship: 'NX Aurora', color: 0x9ad7ff, trim: 0x10304a, hull: 'mono',
    blurb: 'Monocoque raffinée : bonne partout, excellente nulle part.',
    stats: { speed: 7, thrust: 7, handling: 7, shield: 6, weapon: 6, mass: 5 },
  },
  {
    id: 'piraju', name: 'PIRAJU', ship: 'PJ Barracuda', color: 0x7dff4a, trim: 0x0a2a0a, hull: 'needle',
    blurb: 'Ultra-légère, la plus rapide. Fragile et difficile à arrêter.',
    stats: { speed: 10, thrust: 8, handling: 6, shield: 2, weapon: 4, mass: 1 }, brake: 0.6,
  },
];

export const teamById = (id: string): Team => TEAMS.find((t) => t.id === id) ?? TEAMS[0];

/** Valeurs physiques d'un engin dans une difficulté donnée. */
export interface Performance {
  readonly vmax: number;
  readonly accel: number;
  /** Multiplicateur de vitesse de lacet. */
  readonly turn: number;
  /** Multiplicateur d'adhérence latérale. */
  readonly grip: number;
  readonly brake: number;
  /** Multiplicateur des dégâts subis. */
  readonly armor: number;
  /** Multiplicateur des dégâts infligés. */
  readonly firepower: number;
  /** 0.5 (plume) à 1.5 (char) : qui pousse qui lors des contacts. */
  readonly mass: number;
}

/** Ramène une note 1–10 dans [-1, 1]. */
const n = (stat: number) => (stat - 5.5) / 4.5;

export function performance(team: Team, diff: Difficulty): Performance {
  const s = team.stats;
  return {
    vmax: diff.vmax * (1 + 0.06 * n(s.speed)),
    accel: diff.accel * (1 + 0.16 * n(s.thrust)) * (1 - 0.04 * n(s.mass)),
    turn: 1 + 0.12 * n(s.handling),
    grip: 1 + 0.15 * n(s.handling),
    brake: team.brake ?? 1,
    armor: 1 - 0.3 * n(s.shield),
    firepower: 1 + 0.3 * n(s.weapon),
    mass: 1 + 0.5 * n(s.mass),
  };
}
