import type { Ship } from './Ship';

/** Position musicale à l'instant entendu par le joueur. */
export interface BeatSample {
  /** Compteur de temps continu (en temps / noires). */
  readonly beats: number;
  /** Position dans la mesure, 0..4. */
  readonly inBar: number;
  /** Temps par seconde (tempo courant). */
  readonly bps: number;
}

export type GrooveAction = 'pulse' | 'pad' | 'land';
export type GrooveGrade = 'perfect' | 'good' | 'miss';

export interface GrooveResult {
  readonly action: GrooveAction;
  readonly grade: GrooveGrade;
  /** Écart au temps le plus proche (s, négatif = en avance). */
  readonly offset: number;
  /** Sur le premier temps de la mesure. */
  readonly downbeat: boolean;
  /** Série en cours après cette action. */
  readonly streak: number;
}

/** Fenêtres de jugement (s) : un peu plus larges pour les actions subies (pad, atterrissage). */
export const PERFECT_WINDOW = 0.055;
export const GOOD_WINDOW = 0.11;
const PASSIVE_SLACK = 1.4;
/** Série plafonnée (pour le bonus) ; perdue après 4 mesures sans action réussie. */
export const MAX_STREAK = 8;
const STREAK_TIMEOUT_BARS = 4;

/**
 * Impulsion de la touche de rythme (m/s) : base + par palier de série, ×1,3 si parfait, ×1,25 sur le premier temps.
 * Une série parfaite tenue à chaque temps vaut environ +4 % de vitesse de pointe : un avantage
 * qui se sent, pas une stratégie qui écrase le pilotage (les IA groovent aussi, selon la difficulté).
 */
// la traînée ne ramène la vitesse vers la pointe qu'à ~0,33/s : une impulsion à chaque temps
// s'accumule. À 150 BPM, 0,5 m/s par temps en pleine série donne ~+4 % de vitesse d'équilibre.
const PULSE_BASE = 0.15;
const PULSE_PER_STREAK = 0.045;
/** Contretemps : petite perte de vitesse (m/s). */
const MISS_PENALTY = 3;
/** Pad pris sur le temps : boost prolongé (s). */
const PAD_BOOST = 2;
/** Atterrissage sur le temps (m/s). */
const LAND_BONUS = 5;

/**
 * Le rythme comme mécanique de pilotage : la touche de rythme (Maj) jouée sur le temps donne
 * une impulsion qui grandit avec la série ; un pad franchi ou un atterrissage sur le temps
 * rapporte aussi. À contretemps, la touche coûte un peu de vitesse et casse la série.
 * La série nourrit en retour l'intensité de la musique.
 */
export class Groove {
  streak = 0;
  /** Meilleure série de la course. */
  best = 0;
  private lastBeat = Number.NEGATIVE_INFINITY;
  private sinceSuccess = 0;

  reset(): void {
    this.streak = this.best = 0;
    this.lastBeat = Number.NEGATIVE_INFINITY;
    this.sinceSuccess = 0;
  }

  /** Fait expirer la série (temps de course). */
  update(dt: number, sample: BeatSample | null): void {
    this.sinceSuccess += dt;
    const timeout = sample ? (STREAK_TIMEOUT_BARS * 4) / sample.bps : 8;
    if (this.streak > 0 && this.sinceSuccess > timeout) this.streak = 0;
  }

  /** Juge une action et applique son effet au vaisseau. null si l'action ne compte pas (pas de musique, temps déjà joué). */
  act(action: GrooveAction, ship: Ship, sample: BeatSample | null): GrooveResult | null {
    if (!sample || sample.bps <= 0) return null;
    const nearest = Math.round(sample.beats);
    const offset = (sample.beats - nearest) / sample.bps;
    const downbeat = Math.round(sample.inBar) % 4 === 0;
    const slack = action === 'pulse' ? 1 : PASSIVE_SLACK;
    const a = Math.abs(offset);
    const grade: GrooveGrade = a <= PERFECT_WINDOW * slack ? 'perfect' : a <= GOOD_WINDOW * slack ? 'good' : 'miss';

    if (grade === 'miss') {
      // une action subie ratée ne punit pas ; la touche à contretemps casse la série
      if (action !== 'pulse') return null;
      this.streak = 0;
      ship.u = Math.max(0, ship.u - MISS_PENALTY);
      return { action, grade, offset, downbeat, streak: 0 };
    }
    // un seul coup par temps : marteler la touche ne rapporte rien
    if (action === 'pulse' && nearest === this.lastBeat) return null;
    if (action === 'pulse') this.lastBeat = nearest;

    this.streak = Math.min(MAX_STREAK, this.streak + 1);
    this.best = Math.max(this.best, this.streak);
    this.sinceSuccess = 0;
    const k = (grade === 'perfect' ? 1.3 : 1) * (downbeat ? 1.25 : 1);
    switch (action) {
      case 'pulse':
        ship.u += (PULSE_BASE + PULSE_PER_STREAK * (this.streak - 1)) * k;
        break;
      case 'pad':
        ship.boostTime = Math.max(ship.boostTime, PAD_BOOST * k);
        break;
      case 'land':
        ship.u += LAND_BONUS * k;
        break;
    }
    return { action, grade, offset, downbeat, streak: this.streak };
  }
}

/**
 * Les adversaires pilotent en rythme eux aussi : à chaque temps, chaque IA « joue » avec une
 * probabilité qui dépend de la difficulté, avec sa propre série (un temps manqué la remet à zéro).
 * Sans cela, la touche de rythme serait un avantage que seul le joueur possède.
 */
export class GrooveAI {
  private readonly streaks = new Map<Ship, number>();
  private lastBeat = Number.NEGATIVE_INFINITY;

  reset(): void {
    this.streaks.clear();
    this.lastBeat = Number.NEGATIVE_INFINITY;
  }

  /** À chaque pas de simulation : agit une fois par temps entendu. */
  update(ships: readonly Ship[], sample: BeatSample | null, chance: number, rand: () => number = Math.random): void {
    if (!sample) return;
    const beat = Math.floor(sample.beats);
    if (beat === this.lastBeat) return;
    this.lastBeat = beat;
    const downbeat = Math.floor(sample.inBar) === 0;
    for (const ship of ships) {
      if (ship.isPlayer || ship.dead || ship.finished) continue;
      if (rand() >= chance) {
        this.streaks.set(ship, 0);
        continue;
      }
      const streak = Math.min(MAX_STREAK, (this.streaks.get(ship) ?? 0) + 1);
      this.streaks.set(ship, streak);
      // une IA n'est jamais « parfaite » : impulsion d'un coup juste
      ship.u += (PULSE_BASE + PULSE_PER_STREAK * (streak - 1)) * (downbeat ? 1.25 : 1);
    }
  }
}
