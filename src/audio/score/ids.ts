/** Contrat entre la partition et le directeur musical du jeu. */

export const SOUND = {
  /** Thème de course écrit à la main (Neon Ridge). */
  MAIN: 1,
  VICTORY: 2,
  DEFEAT: 3,
  /** Thèmes générés : THEME_BASE + rang du circuit. */
  THEME_BASE: 10,
} as const;

/** Chunks d'un thème de course (communs à tous les thèmes). */
export const MAIN = {
  INTRO: 0,
  GRID: 1,
  CRUISE: 2,
  FILL_UP: 3,
  DRIVE: 4,
  BREAKDOWN: 5,
  FILL_FINAL: 6,
  FINAL: 7,
  OUTRO: 8,
} as const;
export type MainChunk = (typeof MAIN)[keyof typeof MAIN];

/** Classes de hooks. */
export const HOOK = {
  /** Classe des hooks inconditionnels (id 0) écrits pour la mise en place d'une section. */
  SCORE: 'score',
  /** Saut de section ; valeur = une constante JUMP. Consommé quand il se déclenche. */
  JUMP: 'jump',
  /** Densité d'orchestration ; valeur 1..4. */
  LAYER: 'layer',
  /** Alarme bouclier faible ; valeur TENSION.ON / TENSION.OFF. */
  TENSION: 'tension',
  /** Couches rythmiques selon la vitesse du joueur ; valeur = une constante SPEED. */
  SPEED: 'speed',
  /** Rugissement des dragons ; valeur DRAGON.ON / DRAGON.OFF, réévaluée à chaque mesure. */
  DRAGON: 'dragon',
} as const;

/** Valeurs de la classe JUMP : section demandée par le jeu. */
export const JUMP = {
  GRID: 1,
  CRUISE: 2,
  DRIVE: 3,
  BREAKDOWN: 4,
  FINAL: 5,
  FINISH: 6,
  /**
   * Drop calé sur le circuit : montée d'une mesure (FILL_UP) puis DRIVE, possible à chaque mesure
   * de CRUISE, DRIVE et BREAKDOWN. Le directeur l'arme au moment précis où le drop tombera sur l'obstacle.
   */
  DROP: 7,
} as const;

export const TENSION = { ON: 1, OFF: 2 } as const;
export const DRAGON = { ON: 1, OFF: 2 } as const;
export const SPEED = { SLOW: 1, FAST: 2, FASTER: 3, MAX: 4 } as const;
export const LAYER_LEVELS = [1, 2, 3, 4] as const;

export const MARKER = {
  /** Fin de l'outro : le jeu y accroche le lancement du jingle de victoire / défaite. */
  OUTRO_END: 1,
  /** Début de chaque chunk : SECTION_BASE + id du chunk. */
  SECTION_BASE: 100,
} as const;

/** Chunks des jingles. */
export const STINGER = { HIT: 0, LOOP: 1 } as const;
