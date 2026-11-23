import type { Difficulty } from '../config';
import type { BeatSample } from './Groove';
import { performance, type Performance, type Team } from './teams';

export type ItemKind = 'TURBO' | 'IMPULSION' | 'MINES' | 'BOUCLIER';

export interface ShipInput {
  /** 0..1 */
  thrust: number;
  /** 0..1 */
  brake: number;
  /** -1 (gauche) .. 1 (droite) */
  steer: number;
  airbrakeLeft: number;
  airbrakeRight: number;
  /** Demande d'utilisation de l'arme (consommée par la course). */
  fire: boolean;
  /** Touche de rythme (consommée par la course). */
  pulse?: boolean;
  /**
   * Position musicale entendue au moment exact de l'appui : le jugement ne dépend pas de la
   * cadence d'images (absent = jugé au pas de simulation).
   */
  pulseBeat?: BeatSample | null;
}

export function createInput(): ShipInput {
  return { thrust: 0, brake: 0, steer: 0, airbrakeLeft: 0, airbrakeRight: 0, fire: false, pulse: false };
}

/**
 * État simulé d'un vaisseau, exprimé dans le repère de la piste :
 * - s : distance cumulée parcourue (tours inclus), x : décalage latéral
 * - psi : cap relatif à la tangente de la piste
 * - u / w : vitesse longitudinale / latérale dans le repère du vaisseau
 */
export class Ship {
  readonly input: ShipInput = createInput();
  team: Team;
  cfg: Difficulty;
  /** Valeurs physiques : écurie × difficulté. */
  perf: Performance;

  s = 0;
  x = 0;
  psi = 0;
  u = 0;
  w = 0;
  /** Direction lissée (-1..1). */
  steer = 0;
  energy = 100;
  item: ItemKind | null = null;

  boostTime = 0;
  shieldTime = 0;
  stunTime = 0;
  wallCooldown = 0;
  /** Rotation visuelle quand le vaisseau est touché. */
  spin = 0;
  /** -1/1 quand le vaisseau frotte un mur, 0 sinon. */
  scrape = 0;
  /** Multiplicateur de vitesse de pointe (niveau IA, élastique). */
  vmaxMul = 1;
  /** Hauteur de vol au-dessus de la sustentation normale (m) et vitesse verticale (m/s), le long de la normale. */
  h = 0;
  vh = 0;
  /** Vitesse verticale à l'atterrissage du dernier pas (0 sinon) : secousse, étincelles. */
  landImpact = 0;

  lapsDone = -1;
  lapStart = 0;
  lapTimes: number[] = [];
  finished = false;
  finishTime = 0;
  dead = false;

  lastPadId = -1;
  lastPadTime = -Infinity;

  constructor(readonly isPlayer: boolean, team: Team, cfg: Difficulty) {
    this.team = team;
    this.cfg = cfg;
    this.perf = performance(team, cfg);
  }

  get name(): string {
    return this.team.name;
  }

  get color(): number {
    return this.team.color;
  }

  reset(s: number, x: number, cfg: Difficulty, trackLength: number, team: Team = this.team): void {
    this.team = team;
    this.cfg = cfg;
    this.perf = performance(team, cfg);
    this.s = s;
    this.x = x;
    this.psi = this.u = this.w = this.steer = 0;
    this.energy = 100;
    this.item = null;
    this.boostTime = this.shieldTime = this.stunTime = this.wallCooldown = 0;
    this.spin = this.scrape = 0;
    this.vmaxMul = 1;
    this.h = this.vh = this.landImpact = 0;
    this.lapsDone = Math.floor(s / trackLength);
    this.lapStart = 0;
    this.lapTimes = [];
    this.finished = false;
    this.finishTime = 0;
    this.dead = false;
    this.lastPadId = -1;
    this.lastPadTime = -Infinity;
    Object.assign(this.input, { thrust: 0, brake: 0, steer: 0, airbrakeLeft: 0, airbrakeRight: 0, fire: false, pulse: false });
  }

  get speed(): number {
    return Math.abs(this.u);
  }

  get airborne(): boolean {
    return this.h > 0;
  }

  get stunned(): boolean {
    return this.stunTime > 0;
  }

  get shielded(): boolean {
    return this.shieldTime > 0;
  }

  get active(): boolean {
    return !this.dead;
  }
}
