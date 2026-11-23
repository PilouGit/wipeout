import { Vector3, type Object3D } from 'three';
import { BEATS_PER_BAR } from '../../audio/imuse/types';
import { MAIN } from '../../audio/score/ids';
import type { MusicFeatures } from '../../audio/imuse/MusicPulse';
import { follow } from './MusicBands';

/** Motif du sol réactif : égaliseur en spirale, anneaux concentriques, secteurs tournants, houle calme. */
export const PATTERN = { SPIRAL: 0, RINGS: 1, SECTORS: 2, CALM: 3 } as const;
export type Pattern = (typeof PATTERN)[keyof typeof PATTERN];

interface SectionLook {
  /** Niveau de la scène (0..1) : la dynamique d'ensemble du décor dans cette section. */
  readonly level: number;
  readonly pattern: Pattern;
  readonly bars: number;
  /** Mesure à partir de laquelle tout se rétracte avant la section suivante (montée), ou absent. */
  readonly buildFrom?: number;
  /** Décalage de palette du sol (tours de teinte), appliqué net à la coupe. */
  readonly palette: number;
}

/** Mise en scène de chaque section du thème (mêmes chunks pour tous les thèmes). */
const LOOKS: Readonly<Record<number, SectionLook>> = {
  [MAIN.INTRO]: { level: 0.3, pattern: PATTERN.CALM, bars: 8, buildFrom: 6, palette: 0 },
  [MAIN.GRID]: { level: 0.45, pattern: PATTERN.RINGS, bars: 2, palette: 0.5 },
  [MAIN.CRUISE]: { level: 0.7, pattern: PATTERN.SPIRAL, bars: 8, palette: 0 },
  [MAIN.FILL_UP]: { level: 0.6, pattern: PATTERN.RINGS, bars: 1, buildFrom: 0, palette: 0 },
  [MAIN.DRIVE]: { level: 1, pattern: PATTERN.RINGS, bars: 8, palette: 0.33 },
  [MAIN.BREAKDOWN]: { level: 0.18, pattern: PATTERN.CALM, bars: 8, buildFrom: 6, palette: 0.5 },
  [MAIN.FILL_FINAL]: { level: 0.7, pattern: PATTERN.SECTORS, bars: 1, buildFrom: 0, palette: 0.66 },
  [MAIN.FINAL]: { level: 1, pattern: PATTERN.SECTORS, bars: 8, palette: 0.66 },
  [MAIN.OUTRO]: { level: 0.35, pattern: PATTERN.CALM, bars: 2, palette: 0 },
};
const IDLE: SectionLook = { level: 0.3, pattern: PATTERN.CALM, bars: 8, palette: 0 };

/** Vitesse de lacet de la caméra (rad/s) à partir de laquelle le décor s'efface au profit de la piste. */
const FOCUS_YAW = 0.9;

/**
 * Mise en scène du décor, à la manière d'une démo : chaque section musicale est une scène,
 * avec sa dynamique propre (un breakdown presque immobile, un drop qui explose), une montée
 * où tout se rétracte et s'assombrit avant le drop, et une coupe nette au changement de section
 * (éclair, palette, motif du sol). Lue à l'heure audio : la coupe tombe sur le temps entendu.
 *
 * Lisibilité : quand la caméra tourne vite (virage serré), le décor s'efface au profit de la piste.
 */
export class Staging {
  /** Section entendue (chunk iMUSE), et section précédente. */
  section = -1;
  /** Dynamique lissée de la scène (0..1). */
  level = IDLE.level;
  /** Montée en cours (0..1) : le décor se retient avant le drop. */
  build = 0;
  /** Impulsion de coupe (1 au changement de section, décroît en ~0,5 s). */
  cut = 0;
  /** Vrai sur l'image de la coupe. */
  cutNow = false;
  /** Vrai sur l'image d'une coupe vers une section à pleine puissance (le drop). */
  drop = false;
  pattern: Pattern = IDLE.pattern;
  previousPattern: Pattern = IDLE.pattern;
  /** Fondu du motif précédent vers le motif courant (0..1). */
  patternMix = 1;
  palette = 0;
  /** Virage serré en cours (0..1) : le décor se fait discret. */
  focus = 0;
  private readonly fwd = new Vector3();
  private readonly lastFwd = new Vector3();
  private hasFwd = false;

  /** Multiplicateur d'ensemble du décor : niveau de la scène, retenue de la montée, effacement en virage. */
  get intensity(): number {
    return this.level * (1 - 0.8 * this.build) * (1 - 0.5 * this.focus);
  }

  update(dt: number, f: MusicFeatures, camera: Object3D): void {
    this.cutNow = this.drop = false;
    const clock = f.clock;
    let progress = 0;
    if (clock) {
      // juste après un saut, l'horloge est déjà sur le nouveau chunk mais l'audio joue encore l'ancien
      // (temps négatif) : la coupe attend que la nouvelle section soit réellement entendue
      const beats = clock.bar * BEATS_PER_BAR + clock.beat;
      if (beats >= 0 && clock.chunk !== this.section) this.enter(clock.chunk);
      const look = LOOKS[this.section] ?? IDLE;
      // temps négatif = fin de la section entendue (le chunk suivant est déjà planifié)
      progress = beats >= 0 ? beats / BEATS_PER_BAR : look.bars + beats / BEATS_PER_BAR;
      if (look.buildFrom !== undefined && progress >= look.buildFrom) {
        const t = Math.min(1, (progress - look.buildFrom) / (look.bars - look.buildFrom));
        this.build = t * t;
      } else this.build = follow(this.build, 0, dt, 12, 12);
    } else {
      this.build = follow(this.build, 0, dt, 2, 2);
      if (this.section !== -1) this.enter(-1);
    }
    const look = LOOKS[this.section] ?? IDLE;
    this.level = follow(this.level, look.level, dt, 8, 1.2);
    this.cut *= Math.exp(-dt * 4);
    this.patternMix = Math.min(1, this.patternMix + dt / 1.2);

    // effacement en virage : vitesse de lacet de la caméra
    camera.getWorldDirection(this.fwd);
    this.fwd.y = 0;
    if (this.fwd.lengthSq() > 1e-6) {
      this.fwd.normalize();
      if (this.hasFwd && dt > 0) {
        const yaw = this.lastFwd.angleTo(this.fwd) / dt;
        this.focus = follow(this.focus, Math.min(1, yaw / FOCUS_YAW), dt, 6, 1.5);
      }
      this.lastFwd.copy(this.fwd);
      this.hasFwd = true;
    }
  }

  private enter(section: number): void {
    const look = LOOKS[section] ?? IDLE;
    const was = this.section;
    this.section = section;
    if (section === -1 || was === -1) {
      this.pattern = this.previousPattern = look.pattern;
      this.palette = look.palette;
      return;
    }
    this.cutNow = true;
    this.cut = 1;
    // la retenue appartient à la section qui s'achève : la coupe la relâche d'un coup
    this.build = 0;
    this.drop = look.level >= 0.95;
    this.palette = look.palette;
    if (look.pattern !== this.pattern) {
      this.previousPattern = this.pattern;
      this.pattern = look.pattern;
      this.patternMix = 0;
    }
    // le drop part de la retenue : la scène saute directement à son niveau
    if (this.drop) this.level = look.level;
  }
}
