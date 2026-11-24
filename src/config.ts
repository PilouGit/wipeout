/** Réglages globaux du jeu. Toutes les distances sont en mètres, les vitesses en m/s. */

export const TRACK_HALF_WIDTH = 12;
export const SHIP_HALF_WIDTH = 1.4;
export const LAPS = 3;
/** Vitesse de lacet max à la direction (rad/s). */
export const TURN_RATE = 1.15;
/** Lacet supplémentaire apporté par un aérofrein (rad/s). */
export const AIRBRAKE_TURN_RATE = 0.75;
export const HOVER_HEIGHT = 1.15;
export const GROUND_Y = -45;
export const PHYSICS_STEP = 1 / 120;
/** Distance après la ligne d'arrivée où le bouclier se recharge. */
export const RECHARGE_ZONE = 300;

export type DifficultyKey = 'novice' | 'pro' | 'elite';

export interface Difficulty {
  /** Vitesse de pointe hors boost. */
  readonly vmax: number;
  readonly accel: number;
  /** Multiplicateur de vitesse de base de l'IA. */
  readonly ai: number;
  /** Probabilité qu'une IA joue chaque temps (elle aussi pilote en rythme). */
  readonly groove: number;
}

export const DIFFICULTIES: Readonly<Record<DifficultyKey, Difficulty>> = {
  novice: { vmax: 78, accel: 26, ai: 0.86, groove: 0.3 },
  pro: { vmax: 92, accel: 30, ai: 0.93, groove: 0.55 },
  elite: { vmax: 108, accel: 35, ai: 0.98, groove: 0.8 },
};

/** Nombre de vaisseaux en course (joueur compris). */
export const FIELD_SIZE = 6;

/** Niveau relatif de chaque IA, dans l'ordre de la grille de départ. */
export const AI_SKILLS: readonly number[] = [1.03, 1.0, 0.98, 0.96, 0.93];
